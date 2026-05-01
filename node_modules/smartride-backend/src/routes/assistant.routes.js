import { Router } from 'express';
import {
	askAssistantChatController,
	deleteAssistantConversationController,
	getAssistantChatHistoryController,
	listAssistantConversationsController,
	renameAssistantConversationController,
} from '../controllers/assistant.controller.js';

const router = Router();

router.get('/chat/history', getAssistantChatHistoryController);
router.get('/chat/conversations', listAssistantConversationsController);
router.patch('/chat/conversations/:conversationId', renameAssistantConversationController);
router.delete('/chat/conversations/:conversationId', deleteAssistantConversationController);
router.post('/chat/ask', askAssistantChatController);

export default router;
