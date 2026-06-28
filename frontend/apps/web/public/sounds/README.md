# Notification Sounds

This directory contains notification sound files for in-app notifications.

## Files

- `message.mp3` - Sound for channel messages
- `dm.mp3` - Sound for direct messages

## Usage

These sounds are played by the NotificationPopup component when notifications are received.
The sound selection is based on whether the notification is from a direct message channel or a regular channel.

## Customization

To replace the default sounds:
1. Add your custom MP3 files to this directory
2. Keep the same filenames (`message.mp3` and `dm.mp3`)
3. Recommended: Keep file sizes small (<50KB) for fast loading
4. Recommended: Keep duration short (1-2 seconds)
