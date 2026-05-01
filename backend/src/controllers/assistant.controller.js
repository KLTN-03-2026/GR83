import {
  askAssistantChat,
  deleteAssistantConversation,
  getAssistantChatHistory,
  listAssistantConversations,
  renameAssistantConversation,
} from '../services/assistantChat.service.js';

function sendKnownAssistantError(response, error) {
  if (!error?.statusCode) {
    return false;
  }

  response.status(error.statusCode).json({
    success: false,
    message: error.message,
    ...(error.details ?? {}),
  });

  return true;
}

export async function getAssistantChatHistoryController(request, response, next) {
  try {
    const result = await getAssistantChatHistory(request.query);
    response.status(200).json(result);
  } catch (error) {
    if (sendKnownAssistantError(response, error)) {
      return;
    }

    next(error);
  }
}

export async function askAssistantChatController(request, response, next) {
  try {
    const result = await askAssistantChat(request.body);
    response.status(200).json(result);
  } catch (error) {
    if (sendKnownAssistantError(response, error)) {
      return;
    }

    next(error);
  }
}

export async function listAssistantConversationsController(request, response, next) {
  try {
    const result = await listAssistantConversations(request.query);
    response.status(200).json(result);
  } catch (error) {
    if (sendKnownAssistantError(response, error)) {
      return;
    }

    next(error);
  }
}

export async function renameAssistantConversationController(request, response, next) {
  try {
    const result = await renameAssistantConversation({
      ...request.body,
      accountId: request.body?.accountId ?? request.query?.accountId,
      conversationId: request.params.conversationId ?? request.body?.conversationId,
    });
    response.status(200).json(result);
  } catch (error) {
    if (sendKnownAssistantError(response, error)) {
      return;
    }

    next(error);
  }
}

export async function deleteAssistantConversationController(request, response, next) {
  try {
    const result = await deleteAssistantConversation({
      ...request.query,
      accountId: request.query?.accountId ?? request.body?.accountId,
      conversationId: request.params.conversationId ?? request.body?.conversationId,
    });
    response.status(200).json(result);
  } catch (error) {
    if (sendKnownAssistantError(response, error)) {
      return;
    }

    next(error);
  }
}
