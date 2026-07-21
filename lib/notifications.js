import Notification from '../models/Notification.js';
import { getIO } from './socket.js';

/**
 * Create a new notification for a user
 * @param {string} recipientId - User ID of the recipient
 * @param {string} title - Title of the notification
 * @param {string} message - Detailed message
 * @param {string} type - 'info', 'success', 'warning', 'error'
 * @param {string} link - Optional link to navigate to
 */
export const createNotification = async (recipientId, title, message, type = 'info', link = null) => {
  try {
    const notification = new Notification({
      recipient_id: recipientId,
      title,
      message,
      type,
      link
    });
    await notification.save();

    // Emit real-time notification
    const io = getIO();
    if (io) {
      io.to(recipientId.toString()).emit('notification', notification);
    }

    return notification;
  } catch (error) {
    console.error('Failed to create notification:', error);
  }
};
