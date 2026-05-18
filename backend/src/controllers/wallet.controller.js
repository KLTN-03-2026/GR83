import { transferWalletBalance } from '../services/wallet.service.js';
// Chuyển tiền giữa các ví người dùng
export async function transferWallet(req, res) {
  try {
    const senderId = req.user?.id || req.body?.userId;
    const { phone, amount, note } = req.body;
    if (!senderId || !phone || !amount) {
      return res.status(400).json({ success: false, message: 'Thiếu thông tin chuyển tiền' });
    }
    const result = await transferWalletBalance({ senderId, phone, amount, note });
    return res.json(result);
  } catch (error) {
    return res.status(error?.statusCode || 500).json({ success: false, message: error?.message || 'Không thể chuyển tiền' });
  }
}
import { createTopupRequest, handleMomoCallback, handleZaloPayCallback, syncPendingTopups } from '../services/wallet.service.js';

export async function createWalletTopupRequest(req, res) {
  try {
    const amount = req.body?.amount;
    const method = req.body?.method;
    const role = req.body?.role;
    const userId = req.user?.id || req.body?.userId;

    if (!amount || !method || !userId) {
      return res.status(400).json({ success: false, message: 'Thiếu thông tin nạp tiền' });
    }

    const result = await createTopupRequest({ userId, amount, method, role });
    return res.json(result);
  } catch (error) {
    return res.status(error?.statusCode || 500).json({ success: false, message: error?.message || 'Không thể tạo yêu cầu nạp tiền' });
  }
}

export async function momoWalletCallback(req, res) {
  try {
    const result = await handleMomoCallback(req.body);
    return res.json(result);
  } catch (error) {
    return res.status(error?.statusCode || 500).json({ success: false, message: error?.message || 'Không thể xử lý callback MoMo' });
  }
}

export async function zalopayWalletCallback(req, res) {
  try {
    const result = await handleZaloPayCallback(req.body);
    return res.json(result);
  } catch (error) {
    return res.status(error?.statusCode || 500).json({ success: false, message: error?.message || 'Không thể xử lý callback ZaloPay' });
  }
}

export async function syncWalletTopups(req, res) {
  try {
    const userId = req.user?.id || req.body?.userId;
    const role = req.body?.role;

    if (!userId || !role) {
      return res.status(400).json({ success: false, message: 'Thiếu thông tin để đồng bộ nạp tiền' });
    }

    const result = await syncPendingTopups({ userId, role });
    return res.json(result);
  } catch (error) {
    return res.status(error?.statusCode || 500).json({ success: false, message: error?.message || 'Không thể đồng bộ nạp tiền' });
  }
}
