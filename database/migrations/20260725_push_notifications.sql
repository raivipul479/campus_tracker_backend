-- Push-notification support: stores each device's FCM registration token
-- (per parent/driver phone) and a history of notifications sent to each parent.
-- Run once against existing databases before deploying the matching build.

CREATE TABLE IF NOT EXISTS device_tokens (
  id         INT UNSIGNED NOT NULL AUTO_INCREMENT,
  phone      VARCHAR(32)  NOT NULL,
  role       ENUM('parent','driver') NOT NULL DEFAULT 'parent',
  token      VARCHAR(512) NOT NULL,
  platform   VARCHAR(20)  NOT NULL DEFAULT 'android',
  created_at DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_device_tokens_token (token),
  KEY idx_device_tokens_phone (phone)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;

CREATE TABLE IF NOT EXISTS notifications (
  id         INT UNSIGNED NOT NULL AUTO_INCREMENT,
  phone      VARCHAR(32)  NOT NULL,
  student_id INT UNSIGNED NULL,
  type       ENUM('Pickup','Drop','FeeReminder') NOT NULL,
  title      VARCHAR(160) NOT NULL,
  body       VARCHAR(500) NOT NULL,
  read_at    DATETIME(3)  NULL,
  created_at DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_notifications_phone_date (phone, created_at)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;
