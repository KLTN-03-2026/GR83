import { request } from '../api/httpClient';

function buildHistoryQueryString(params = {}) {
  const searchParams = new URLSearchParams();

  if (params.accountId) {
    searchParams.set('accountId', String(params.accountId));
  }

  if (params.roleCode) {
    searchParams.set('roleCode', String(params.roleCode));
  }

  if (params.conversationId) {
    searchParams.set('conversationId', String(params.conversationId));
  }

  if (params.limit) {
    searchParams.set('limit', String(params.limit));
  }

  const queryString = searchParams.toString();
  return queryString ? `?${queryString}` : '';
}

function buildConversationQueryString(params = {}) {
  const searchParams = new URLSearchParams();

  if (params.accountId) {
    searchParams.set('accountId', String(params.accountId));
  }

  if (params.roleCode) {
    searchParams.set('roleCode', String(params.roleCode));
  }

  if (params.scope) {
    searchParams.set('scope', String(params.scope));
  }

  if (params.keyword) {
    searchParams.set('keyword', String(params.keyword));
  }

  if (params.limit) {
    searchParams.set('limit', String(params.limit));
  }

  const queryString = searchParams.toString();
  return queryString ? `?${queryString}` : '';
}

export const assistantChatService = {
  getHistory(params = {}, { signal } = {}) {
    return request(`/assistant/chat/history${buildHistoryQueryString(params)}`, {
      method: 'GET',
      signal,
    });
  },
  ask(payload = {}, { signal } = {}) {
    return request('/assistant/chat/ask', {
      method: 'POST',
      signal,
      body: JSON.stringify(payload && typeof payload === 'object' ? payload : {}),
    });
  },
  listConversations(params = {}, { signal } = {}) {
    return request(`/assistant/chat/conversations${buildConversationQueryString(params)}`, {
      method: 'GET',
      signal,
    });
  },
  renameConversation(conversationId, payload = {}, { signal } = {}) {
    return request(`/assistant/chat/conversations/${encodeURIComponent(String(conversationId ?? '').trim())}`, {
      method: 'PATCH',
      signal,
      body: JSON.stringify(payload && typeof payload === 'object' ? payload : {}),
    });
  },
  deleteConversation(conversationId, params = {}, { signal } = {}) {
    return request(`/assistant/chat/conversations/${encodeURIComponent(String(conversationId ?? '').trim())}${buildConversationQueryString(params)}`, {
      method: 'DELETE',
      signal,
    });
  },
};
