import { createPortal } from 'react-dom';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { closeIcon } from '../../assets/icons';
import { assistantChatService } from '../../services/assistantChatService';

const QUICK_ASK_ITEMS = [
  'Tôi muốn đặt xe',
  'Hướng dẫn hủy chuyến',
  'Cách áp dụng mã khuyến mãi',
  'Thanh toán bằng tiền mặt như thế nào?',
  'Khi nào tôi có thể đánh giá tài xế?',
];

function normalizeText(value) {
  return String(value ?? '')
    .trim()
    .replace(/\s+/g, ' ');
}

function normalizeSearchToken(value) {
  return normalizeText(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'd')
    .toLowerCase();
}

/**
 * Convert a subset of Markdown to safe HTML for chat bubbles.
 * Handles: **bold**, *italic*, numbered lists, bullet lists, newlines.
 * All raw HTML is escaped first to prevent XSS.
 */
function renderMarkdown(text) {
  if (!text) return '';

  // 1. Escape HTML to prevent XSS
  let html = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  // 2. Bold: **text**
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');

  // 3. Italic: *text* (single, not already consumed by bold)
  html = html.replace(/\*([^*\n]+)\*/g, '<em>$1</em>');

  // 4. Split into lines and process list structure
  const lines = html.split(/\n/);
  const result = [];
  let inList = false;

  for (const line of lines) {
    const numbered = line.match(/^\d+\.\s+(.*)$/);
    const bullet = line.match(/^[-•]\s+(.*)$/);

    if (numbered || bullet) {
      if (!inList) {
        result.push('<ul class="chatbot-md-list">');
        inList = true;
      }
      result.push(`<li>${(numbered || bullet)[1]}</li>`);
    } else {
      if (inList) {
        result.push('</ul>');
        inList = false;
      }
      result.push(line === '' ? '<br>' : `<span>${line}</span><br>`);
    }
  }
  if (inList) result.push('</ul>');

  return result.join('');
}

function buildStorageKey(accountId = '') {
  const normalizedAccountId = normalizeText(accountId).toLowerCase() || 'guest';
  return `smartride.assistantChat.conversation.${normalizedAccountId}`;
}

function formatMessageTime(timestamp) {
  if (!timestamp) return '';

  const dateValue = new Date(timestamp);

  if (Number.isNaN(dateValue.getTime())) {
    return '';
  }

  // Backend now stores SYSUTCDATETIME() (true UTC). toISOString() tags with Z.
  // Browser getHours() converts UTC → local timezone correctly.
  const hours = String(dateValue.getHours()).padStart(2, '0');
  const minutes = String(dateValue.getMinutes()).padStart(2, '0');
  return `${hours}:${minutes}`;
}

function normalizeIncomingMessage(message) {
  const senderRole = normalizeText(message?.senderRole).toLowerCase() || 'assistant';

  return {
    id: normalizeText(message?.id) || `${senderRole}-${Date.now()}`,
    senderRole: senderRole === 'user' ? 'user' : 'assistant',
    text: normalizeText(message?.text),
    createdAt: normalizeText(message?.createdAt),
  };
}

function normalizeIncomingConversation(conversation) {
  return {
    conversationId: normalizeText(conversation?.conversationId),
    title: normalizeText(conversation?.title) || 'Hội thoại mới',
    updatedAt: normalizeText(conversation?.updatedAt),
  };
}

function formatConversationTime(timestamp) {
  const dateValue = timestamp ? new Date(timestamp) : null;

  if (!dateValue || Number.isNaN(dateValue.getTime())) {
    return '';
  }

  const now = new Date();
  const isSameDate = dateValue.getDate() === now.getDate()
    && dateValue.getMonth() === now.getMonth()
    && dateValue.getFullYear() === now.getFullYear();

  if (isSameDate) {
    return formatMessageTime(timestamp);
  }

  const day = String(dateValue.getDate()).padStart(2, '0');
  const month = String(dateValue.getMonth() + 1).padStart(2, '0');
  return `${day}/${month}`;
}

function buildConversationId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  return `chat-${Date.now()}-${Math.round(Math.random() * 1_000_000)}`;
}

function extractRetryAfterSecondsFromText(text) {
  const normalizedText = normalizeText(text).toLowerCase();

  if (!normalizedText) {
    return 0;
  }

  const match = normalizedText.match(/sau\s+khoang\s+(\d+)\s+giay/);
  if (!match?.[1]) {
    return 0;
  }

  const parsed = Number(match[1]);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

export default function AssistantChatbotPopup({
  open = false,
  onClose,
  onNotify,
  accountId = '',
  roleCode = '',
}) {
  const [conversationId, setConversationId] = useState('');
  const [recentConversations, setRecentConversations] = useState([]);
  const [conversationScope, setConversationScope] = useState('recent');
  const [conversationKeyword, setConversationKeyword] = useState('');
  const [messages, setMessages] = useState([]);
  const [inputValue, setInputValue] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadingConversationId, setLoadingConversationId] = useState('');
  const [conversationActionLoadingId, setConversationActionLoadingId] = useState('');
  const [sending, setSending] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [sendError, setSendError] = useState('');
  const [autoRetryRemainingSeconds, setAutoRetryRemainingSeconds] = useState(0);
  const [autoRetryNotice, setAutoRetryNotice] = useState('');
  const threadRef = useRef(null);
  const inputRef = useRef(null);
  const activeRequestRef = useRef(0);
  const autoRetryTimeoutRef = useRef(null);
  const autoRetryCountdownRef = useRef(null);

  const normalizedAccountId = normalizeText(accountId);
  const normalizedRoleCode = normalizeText(roleCode).toUpperCase();
  const storageKey = useMemo(() => buildStorageKey(normalizedAccountId), [normalizedAccountId]);

  const clearAutoRetry = useCallback(() => {
    if (autoRetryTimeoutRef.current) {
      window.clearTimeout(autoRetryTimeoutRef.current);
      autoRetryTimeoutRef.current = null;
    }

    if (autoRetryCountdownRef.current) {
      window.clearInterval(autoRetryCountdownRef.current);
      autoRetryCountdownRef.current = null;
    }

    setAutoRetryRemainingSeconds(0);
    setAutoRetryNotice('');
  }, []);

  const scheduleAutoRetry = useCallback((messageText, retryAfterSeconds, sendAction) => {
    if (!retryAfterSeconds || retryAfterSeconds <= 0) {
      return;
    }

    clearAutoRetry();

    setAutoRetryRemainingSeconds(retryAfterSeconds);
    setAutoRetryNotice(`Hệ thống sẽ tự thử lại sau ${retryAfterSeconds} giây...`);

    autoRetryCountdownRef.current = window.setInterval(() => {
      setAutoRetryRemainingSeconds((current) => {
        if (current <= 1) {
          if (autoRetryCountdownRef.current) {
            window.clearInterval(autoRetryCountdownRef.current);
            autoRetryCountdownRef.current = null;
          }

          setAutoRetryNotice('Đang tự thử lại...');
          return 0;
        }

        const nextValue = current - 1;
        setAutoRetryNotice(`Hệ thống sẽ tự thử lại sau ${nextValue} giây...`);
        return nextValue;
      });
    }, 1000);

    autoRetryTimeoutRef.current = window.setTimeout(() => {
      autoRetryTimeoutRef.current = null;
      if (autoRetryCountdownRef.current) {
        window.clearInterval(autoRetryCountdownRef.current);
        autoRetryCountdownRef.current = null;
      }

      void sendAction(messageText, { isAutoRetry: true });
    }, retryAfterSeconds * 1000);
  }, [clearAutoRetry]);

  const applyHistoryPayload = useCallback((response) => {
    const resolvedConversationId = normalizeText(response?.conversation?.conversationId);

    if (resolvedConversationId && typeof window !== 'undefined') {
      window.localStorage.setItem(storageKey, resolvedConversationId);
    }

    setConversationId(resolvedConversationId);

    const normalizedRecentConversations = Array.isArray(response?.recentConversations)
      ? response.recentConversations
        .map((item) => normalizeIncomingConversation(item))
        .filter((item) => item.conversationId)
      : [];

    setRecentConversations(normalizedRecentConversations);

    const remoteMessages = Array.isArray(response?.messages)
      ? response.messages.map((item) => normalizeIncomingMessage(item)).filter((item) => item.text)
      : [];

    if (remoteMessages.length > 0) {
      setMessages(remoteMessages);
      return;
    }

    setMessages([
      {
        id: 'assistant-welcome',
        senderRole: 'assistant',
        text: 'Xin chào! Mình là trợ lý AI SmartRide. Bạn cần hỗ trợ đặt xe, giá cước hay cách dùng chức năng nào?',
        createdAt: new Date().toISOString(),
      },
    ]);
  }, [storageKey]);

  const loadHistory = useCallback(async (targetConversationId = '', { signal } = {}) => {
    const response = await assistantChatService.getHistory(
      {
        accountId: normalizedAccountId,
        roleCode: normalizedRoleCode || 'Q2',
        conversationId: normalizeText(targetConversationId),
        limit: 120,
      },
      { signal },
    );

    applyHistoryPayload(response);
    return response;
  }, [applyHistoryPayload, normalizedAccountId, normalizedRoleCode]);

  const loadConversationList = useCallback(async ({ scope, keyword, signal } = {}) => {
    const response = await assistantChatService.listConversations(
      {
        accountId: normalizedAccountId,
        roleCode: normalizedRoleCode || 'Q2',
        scope: scope || conversationScope,
        keyword: normalizeText(keyword ?? conversationKeyword),
      },
      { signal },
    );

    const normalizedItems = Array.isArray(response?.items)
      ? response.items
        .map((item) => normalizeIncomingConversation(item))
        .filter((item) => item.conversationId)
      : [];

    setRecentConversations(normalizedItems);
    return normalizedItems;
  }, [conversationKeyword, conversationScope, normalizedAccountId, normalizedRoleCode]);

  useEffect(() => {
    if (!open) {
      setInputValue('');
      setSendError('');
      clearAutoRetry();
      return;
    }

    inputRef.current?.focus();
  }, [clearAutoRetry, open]);

  useEffect(() => () => {
    clearAutoRetry();
  }, [clearAutoRetry]);

  useEffect(() => {
    if (!open || typeof window === 'undefined') {
      return undefined;
    }

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose?.();
      }
    };

    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClose, open]);

  useEffect(() => {
    if (!open) {
      return undefined;
    }

    const requestId = activeRequestRef.current + 1;
    activeRequestRef.current = requestId;

    const abortController = new AbortController();
    let mounted = true;

    const loadInitialHistory = async () => {
      setLoading(true);
      setLoadError('');

      try {
        const storedConversationId = typeof window !== 'undefined'
          ? normalizeText(window.localStorage.getItem(storageKey))
          : '';

        const response = await loadHistory(storedConversationId, { signal: abortController.signal });

        if (!mounted || activeRequestRef.current !== requestId) {
          return;
        }

        return response;
      } catch (error) {
        if (error?.name === 'AbortError') {
          return;
        }

        setLoadError(error?.message || 'Không thể tải lịch sử hội thoại.');
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    };

    void loadInitialHistory();

    return () => {
      mounted = false;
      abortController.abort();
    };
  }, [loadHistory, open, storageKey]);

  useEffect(() => {
    if (!open) {
      return undefined;
    }

    const abortController = new AbortController();

    const timerId = window.setTimeout(() => {
      void loadConversationList({
        scope: conversationScope,
        keyword: conversationKeyword,
        signal: abortController.signal,
      }).catch((error) => {
        if (error?.name === 'AbortError') {
          return;
        }

        setLoadError(error?.message || 'Không thể tải danh sách hội thoại.');
      });
    }, 220);

    return () => {
      window.clearTimeout(timerId);
      abortController.abort();
    };
  }, [conversationKeyword, conversationScope, loadConversationList, open]);

  useEffect(() => {
    if (!open || !threadRef.current) {
      return;
    }

    threadRef.current.scrollTop = threadRef.current.scrollHeight;
  }, [messages, open, sending]);

  if (!open) {
    return null;
  }

  const handleSend = async (messageOverride = '', options = {}) => {
    const isAutoRetry = Boolean(options?.isAutoRetry);
    const messageText = normalizeText(messageOverride || inputValue);

    if (!messageText || sending) {
      return;
    }

    if (!isAutoRetry) {
      clearAutoRetry();
    }

    setSendError('');
    if (!isAutoRetry) {
      setInputValue('');
    }

    const tempUserMessage = {
      id: `user-${Date.now()}`,
      senderRole: 'user',
      text: messageText,
      createdAt: new Date().toISOString(),
    };

    if (!isAutoRetry) {
      setMessages((currentMessages) => [...currentMessages, tempUserMessage]);
    }

    setSending(true);

    try {
      const response = await assistantChatService.ask({
        accountId: normalizedAccountId,
        roleCode: normalizedRoleCode || 'Q2',
        conversationId,
        message: messageText,
      });

      const resolvedConversationId = normalizeText(response?.conversation?.conversationId ?? conversationId);

      if (resolvedConversationId && typeof window !== 'undefined') {
        window.localStorage.setItem(storageKey, resolvedConversationId);
      }

      setConversationId(resolvedConversationId);

      const normalizedConversation = normalizeIncomingConversation(response?.conversation);
      if (normalizedConversation.conversationId) {
        setRecentConversations((current) => {
          const withoutCurrent = current.filter((item) => item.conversationId !== normalizedConversation.conversationId);
          return [
            {
              ...normalizedConversation,
              title: normalizedConversation.title || normalizeText(messageText).slice(0, 120) || 'Hội thoại mới',
              updatedAt: new Date().toISOString(),
            },
            ...withoutCurrent,
          ];
        });
      }

      const userMessage = normalizeIncomingMessage(response?.userMessage ?? tempUserMessage);
      const assistantMessage = normalizeIncomingMessage(response?.assistantMessage ?? {
        senderRole: 'assistant',
        text: 'Mình đã nhận được yêu cầu của bạn.',
      });

      const retryAfterSeconds = extractRetryAfterSecondsFromText(assistantMessage.text);
      const isQuotaMessage = retryAfterSeconds > 0 || /tam\s*het\s*quota|h[êe]t\s*quota/i.test(normalizeSearchToken(assistantMessage.text));

      if (retryAfterSeconds > 0 && !isAutoRetry) {
        clearAutoRetry();
        setAutoRetryNotice(`Gemini đang bận. Bạn vui lòng thử lại sau khoảng ${retryAfterSeconds} giây.`);
        setAutoRetryRemainingSeconds(0);
      } else if (!isAutoRetry) {
        setAutoRetryNotice('');
        setAutoRetryRemainingSeconds(0);
      }

      if (isAutoRetry && isQuotaMessage) {
        setAutoRetryNotice(
          retryAfterSeconds > 0
            ? `Gemini vẫn đang hết quota. Bạn thử lại thủ công sau khoảng ${retryAfterSeconds} giây.`
            : 'Gemini vẫn đang hết quota. Bạn vui lòng thử lại sau ít phút.',
        );
        return;
      }

      setMessages((currentMessages) => {
        const withoutTemp = currentMessages.filter((item) => item.id !== tempUserMessage.id);

        if (isAutoRetry) {
          return [...withoutTemp, assistantMessage].filter((item) => normalizeText(item.text));
        }

        return [...withoutTemp, userMessage, assistantMessage].filter((item) => normalizeText(item.text));
      });
    } catch (error) {
      setSendError(error?.message || 'Không thể gửi câu hỏi tới trợ lý AI.');
    } finally {
      setSending(false);
      inputRef.current?.focus();
    }
  };

  const handleFormSubmit = async (event) => {
    event.preventDefault();
    await handleSend();
  };

  const handleSelectConversation = async (targetConversationId) => {
    const normalizedTargetConversationId = normalizeText(targetConversationId);

    if (!normalizedTargetConversationId || normalizedTargetConversationId === conversationId || loading || sending) {
      return;
    }

    setLoadingConversationId(normalizedTargetConversationId);
    setLoadError('');
    setSendError('');

    try {
      await loadHistory(normalizedTargetConversationId);
    } catch (error) {
      setLoadError(error?.message || 'Không thể chuyển phiên hội thoại.');
    } finally {
      setLoadingConversationId('');
    }
  };

  const handleCreateConversation = async () => {
    if (loading || sending) {
      return;
    }

    const newConversationId = buildConversationId();
    setLoadingConversationId(newConversationId);
    setLoadError('');
    setSendError('');

    try {
      await loadHistory(newConversationId);
    } catch (error) {
      setLoadError(error?.message || 'Không thể tạo phiên hội thoại mới.');
    } finally {
      setLoadingConversationId('');
      inputRef.current?.focus();
    }
  };

  const handleRenameConversation = async (targetConversation) => {
    const targetConversationId = normalizeText(targetConversation?.conversationId);

    if (!targetConversationId || loading || sending) {
      return;
    }

    const nextTitle = normalizeText(
      typeof window !== 'undefined'
        ? window.prompt('Nhập tên mới cho phiên hội thoại:', targetConversation?.title || 'Hội thoại mới')
        : '',
    );

    if (!nextTitle) {
      return;
    }

    setConversationActionLoadingId(targetConversationId);
    setLoadError('');

    try {
      await assistantChatService.renameConversation(targetConversationId, {
        accountId: normalizedAccountId,
        title: nextTitle,
      });

      onNotify?.('Đổi tên phiên hội thoại thành công.', 'success', 1800);

      setRecentConversations((current) => current.map((item) => (
        item.conversationId === targetConversationId
          ? {
              ...item,
              title: nextTitle,
              updatedAt: new Date().toISOString(),
            }
          : item
      )));
    } catch (error) {
      setLoadError(error?.message || 'Không thể đổi tên phiên hội thoại.');
    } finally {
      setConversationActionLoadingId('');
    }
  };

  const handleDeleteConversation = async (targetConversation) => {
    const targetConversationId = normalizeText(targetConversation?.conversationId);

    if (!targetConversationId || loading || sending) {
      return;
    }

    const shouldDelete = typeof window !== 'undefined'
      ? window.confirm('Bạn có chắc muốn xóa phiên hội thoại này không?')
      : true;

    if (!shouldDelete) {
      return;
    }

    setConversationActionLoadingId(targetConversationId);
    setLoadError('');

    try {
      await assistantChatService.deleteConversation(targetConversationId, {
        accountId: normalizedAccountId,
        roleCode: normalizedRoleCode || 'Q2',
      });

      onNotify?.('Đã xóa phiên hội thoại.', 'success', 1800);

      const filteredConversations = recentConversations.filter((item) => item.conversationId !== targetConversationId);
      setRecentConversations(filteredConversations);

      if (conversationId === targetConversationId) {
        if (filteredConversations.length > 0) {
          await handleSelectConversation(filteredConversations[0].conversationId);
        } else {
          await handleCreateConversation();
        }
      }
    } catch (error) {
      setLoadError(error?.message || 'Không thể xóa phiên hội thoại.');
    } finally {
      setConversationActionLoadingId('');
    }
  };

  return createPortal(
    <div className="assistant-chatbot" role="dialog" aria-modal="true" aria-label="Chat với trợ lý AI">
      <div className="assistant-chatbot__backdrop" onClick={onClose} aria-hidden="true" />

      <section className="assistant-chatbot__sheet">
        <header className="assistant-chatbot__header">
          <div>
            <p className="assistant-chatbot__eyebrow">Chat với trợ lý</p>
            <h3>SmartRide AI Assistant</h3>
          </div>

          <button className="assistant-chatbot__close" type="button" onClick={onClose} aria-label="Đóng cửa sổ chatbot">
            <img src={closeIcon} alt="" aria-hidden="true" />
          </button>
        </header>

        <aside className="assistant-chatbot__sidebar" aria-label="Danh sách phiên hội thoại">
          <div className="assistant-chatbot__tabs" role="tablist" aria-label="Bộ lọc phiên hội thoại">
            <button
              type="button"
              className={`assistant-chatbot__tab${conversationScope === 'recent' ? ' is-active' : ''}`}
              onClick={() => setConversationScope('recent')}
            >
              Gần đây
            </button>
            <button
              type="button"
              className={`assistant-chatbot__tab${conversationScope === 'all' ? ' is-active' : ''}`}
              onClick={() => setConversationScope('all')}
            >
              Tất cả phiên
            </button>
          </div>

          <input
            className="assistant-chatbot__search"
            value={conversationKeyword}
            onChange={(event) => setConversationKeyword(event.target.value)}
            placeholder="Tìm theo tiêu đề..."
            maxLength={120}
          />

          <button
            className="assistant-chatbot__new-conversation"
            type="button"
            onClick={() => {
              void handleCreateConversation();
            }}
            disabled={loading || sending}
          >
            + Phiên mới
          </button>

          <div className="assistant-chatbot__conversation-list">
            {recentConversations.length === 0 ? (
              <p className="assistant-chatbot__conversation-empty">Chưa có phiên hội thoại nào.</p>
            ) : recentConversations.map((conversation) => (
              <div
                key={conversation.conversationId}
                className={`assistant-chatbot__conversation-item${conversation.conversationId === conversationId ? ' is-active' : ''}`}
              >
                <button
                  type="button"
                  className="assistant-chatbot__conversation-main"
                  onClick={() => {
                    void handleSelectConversation(conversation.conversationId);
                  }}
                  disabled={loading || sending}
                >
                  <strong>{conversation.title || 'Hội thoại mới'}</strong>
                  <span>
                    {loadingConversationId && loadingConversationId === conversation.conversationId
                      ? 'Đang mở...'
                      : (formatConversationTime(conversation.updatedAt) || 'Vừa xong')}
                  </span>
                </button>

                <div className="assistant-chatbot__conversation-actions">
                  <button
                    type="button"
                    className="assistant-chatbot__conversation-action"
                    onClick={() => {
                      void handleRenameConversation(conversation);
                    }}
                    disabled={loading || sending || conversationActionLoadingId === conversation.conversationId}
                  >
                    Đổi tên
                  </button>
                  <button
                    type="button"
                    className="assistant-chatbot__conversation-action assistant-chatbot__conversation-action--danger"
                    onClick={() => {
                      void handleDeleteConversation(conversation);
                    }}
                    disabled={loading || sending || conversationActionLoadingId === conversation.conversationId}
                  >
                    Xóa
                  </button>
                </div>
              </div>
            ))}
          </div>
        </aside>

        <div className="assistant-chatbot__thread" ref={threadRef}>
          {messages.map((message) => (
            <article
              key={message.id}
              className={`assistant-chatbot__bubble assistant-chatbot__bubble--${message.senderRole === 'user' ? 'user' : 'assistant'}`}
            >
              {message.senderRole === 'user' ? (
                <p>{message.text}</p>
              ) : (
                <div
                  className="assistant-chatbot__md"
                  dangerouslySetInnerHTML={{ __html: renderMarkdown(message.text) }}
                />
              )}
              <time>{formatMessageTime(message.createdAt)}</time>
            </article>
          ))}

          {sending ? <p className="assistant-chatbot__typing">Trợ lý đang phản hồi...</p> : null}
        </div>

        <div className="assistant-chatbot__quick-asks" aria-label="Gợi ý nhanh">
          {QUICK_ASK_ITEMS.map((item) => (
            <button
              key={item}
              className="assistant-chatbot__quick-item"
              type="button"
              onClick={() => {
                void handleSend(item);
              }}
              disabled={sending}
            >
              {item}
            </button>
          ))}
        </div>

        <form className="assistant-chatbot__composer" onSubmit={handleFormSubmit}>
          <input
            ref={inputRef}
            className="assistant-chatbot__input"
            value={inputValue}
            onChange={(event) => setInputValue(event.target.value)}
            placeholder="Nhập câu hỏi hoặc yêu cầu hỗ trợ..."
            maxLength={2000}
            disabled={sending}
          />

          <button className="assistant-chatbot__send" type="submit" disabled={sending || !normalizeText(inputValue)}>
            Gửi
          </button>
        </form>

        {loading ? <p className="assistant-chatbot__status">Đang tải lịch sử hội thoại...</p> : null}
        {autoRetryNotice ? <p className="assistant-chatbot__status">{autoRetryNotice}</p> : null}
        {loadError ? <p className="assistant-chatbot__status assistant-chatbot__status--error">{loadError}</p> : null}
        {sendError ? <p className="assistant-chatbot__status assistant-chatbot__status--error">{sendError}</p> : null}
      </section>
    </div>,
    document.body,
  );
}
