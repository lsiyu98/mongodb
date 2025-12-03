-- ========================================
-- 校園餐飲點餐系統 -DDL
-- 去掉：多語言、複雜通知系統、密碼重置
-- ========================================

-- 創建數據庫
DROP DATABASE IF EXISTS CampusFoodDB;
CREATE DATABASE CampusFoodDB 
DEFAULT CHARACTER SET utf8mb4 
DEFAULT COLLATE utf8mb4_unicode_ci;

USE CampusFoodDB;

-- ========================================
-- 1. 用戶表
-- ========================================
CREATE TABLE User (
  UserID INT AUTO_INCREMENT PRIMARY KEY,
  SSOID VARCHAR(100) UNIQUE,
  Name VARCHAR(100) NOT NULL,
  Phone VARCHAR(20),
  Email VARCHAR(255) UNIQUE NOT NULL,
  PasswordHash VARCHAR(255) NOT NULL,
  Role ENUM('EndUser', 'ServiceProvider', 'SystemAdmin') DEFAULT 'EndUser',
  IsActive TINYINT DEFAULT 1,
  LastLogin DATETIME,
  CreatedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
  UpdatedAt DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  DeletedAt DATETIME,
  INDEX idx_email (Email),
  INDEX idx_role (Role)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE utf8mb4_unicode_ci;

-- ========================================
-- 2. 商店表
-- ========================================
CREATE TABLE Store (
  StoreID INT AUTO_INCREMENT PRIMARY KEY,
  VendorID INT NOT NULL,
  StoreName VARCHAR(100) NOT NULL,
  Description VARCHAR(500),
  PhoneNumber VARCHAR(20),
  Address VARCHAR(255),
  OperatingHours VARCHAR(100),
  IsOpen TINYINT DEFAULT 1,
  CreatedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
  UpdatedAt DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  DeletedAt DATETIME,
  FOREIGN KEY (VendorID) REFERENCES User(UserID),
  INDEX idx_vendor (VendorID),
  INDEX idx_is_open (IsOpen)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE utf8mb4_unicode_ci;

-- ========================================
-- 3. 菜單項表
-- ========================================
CREATE TABLE MenuItem (
  MenuItemID INT AUTO_INCREMENT PRIMARY KEY,
  StoreID INT NOT NULL,
  ItemName VARCHAR(100) NOT NULL,
  Description VARCHAR(500),
  Price DECIMAL(10, 2) NOT NULL,
  ImageURL VARCHAR(500),
  IsAvailable TINYINT DEFAULT 1,
  CreatedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
  UpdatedAt DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  DeletedAt DATETIME,
  FOREIGN KEY (StoreID) REFERENCES Store(StoreID),
  INDEX idx_store (StoreID),
  INDEX idx_is_available (IsAvailable)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE utf8mb4_unicode_ci;

-- ========================================
-- 4. 訂單表
-- ========================================
CREATE TABLE Orders (
  OrderID INT AUTO_INCREMENT PRIMARY KEY,
  UserID INT NOT NULL,
  StoreID INT NOT NULL,
  OrderStatus ENUM('Pending', 'Confirmed', 'Preparing', 'Ready', 'Delivered', 'Cancelled') DEFAULT 'Pending',
  TotalAmount DECIMAL(10, 2) NOT NULL,
  DeliveryAddress VARCHAR(255),
  SpecialInstructions TEXT,
  CreatedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
  UpdatedAt DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  DeletedAt DATETIME,
  FOREIGN KEY (UserID) REFERENCES User(UserID),
  FOREIGN KEY (StoreID) REFERENCES Store(StoreID),
  INDEX idx_user (UserID),
  INDEX idx_store (StoreID),
  INDEX idx_status (OrderStatus),
  INDEX idx_created_at (CreatedAt)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE utf8mb4_unicode_ci;

-- ========================================
-- 5. 訂單項表（購物車中的項目）
-- ========================================
CREATE TABLE OrderItem (
  OrderItemID INT AUTO_INCREMENT PRIMARY KEY,
  OrderID INT NOT NULL,
  MenuItemID INT NOT NULL,
  Quantity INT NOT NULL DEFAULT 1,
  Price DECIMAL(10, 2) NOT NULL,
  CreatedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (OrderID) REFERENCES Orders(OrderID),
  FOREIGN KEY (MenuItemID) REFERENCES MenuItem(MenuItemID),
  INDEX idx_order (OrderID),
  INDEX idx_menu_item (MenuItemID)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE utf8mb4_unicode_ci;

-- ========================================
-- 6. 支付表
-- ========================================
CREATE TABLE Payment (
  PaymentID INT AUTO_INCREMENT PRIMARY KEY,
  OrderID INT NOT NULL UNIQUE,
  PaymentMethod ENUM('CreditCard', 'Debit', 'Cash', 'LinePayment', 'Wallet') DEFAULT 'CreditCard',
  PaymentStatus ENUM('Pending', 'Completed', 'Failed', 'Refunded') DEFAULT 'Pending',
  Amount DECIMAL(10, 2) NOT NULL,
  TransactionID VARCHAR(255),
  PaymentDate DATETIME,
  CreatedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
  UpdatedAt DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (OrderID) REFERENCES Orders(OrderID),
  INDEX idx_status (PaymentStatus),
  INDEX idx_order (OrderID)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE utf8mb4_unicode_ci;

-- ========================================
-- 7. 評論表
-- ========================================
CREATE TABLE Review (
  ReviewID INT AUTO_INCREMENT PRIMARY KEY,
  UserID INT NOT NULL,
  OrderID INT NOT NULL,
  Rating INT CHECK (Rating >= 1 AND Rating <= 5),
  Comment TEXT,
  CreatedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
  UpdatedAt DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  DeletedAt DATETIME,
  FOREIGN KEY (UserID) REFERENCES User(UserID),
  FOREIGN KEY (OrderID) REFERENCES Orders(OrderID),
  INDEX idx_user (UserID),
  INDEX idx_order (OrderID),
  INDEX idx_rating (Rating)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE utf8mb4_unicode_ci;

-- ========================================
-- 8. 消息表（用戶間通信）
-- ========================================
CREATE TABLE Message (
  MessageID INT AUTO_INCREMENT PRIMARY KEY,
  SenderID INT NOT NULL,
  ReceiverID INT NOT NULL,
  OrderID INT,
  MessageContent TEXT NOT NULL,
  IsRead TINYINT DEFAULT 0,
  CreatedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (SenderID) REFERENCES User(UserID),
  FOREIGN KEY (ReceiverID) REFERENCES User(UserID),
  FOREIGN KEY (OrderID) REFERENCES Orders(OrderID),
  INDEX idx_receiver (ReceiverID),
  INDEX idx_is_read (IsRead),
  INDEX idx_created_at (CreatedAt)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE utf8mb4_unicode_ci;

-- ========================================
-- 9. 系統公告表
-- ========================================
CREATE TABLE PublicNotice (
  NoticeID INT AUTO_INCREMENT PRIMARY KEY,
  Title VARCHAR(200) NOT NULL,
  Content TEXT NOT NULL,
  Priority ENUM('Low', 'Medium', 'High') DEFAULT 'Medium',
  IsActive TINYINT DEFAULT 1,
  CreatedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
  UpdatedAt DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  DeletedAt DATETIME,
  INDEX idx_is_active (IsActive)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE utf8mb4_unicode_ci;

-- NotificationTemplate
CREATE TABLE NotificationTemplate (
  TemplateID INT AUTO_INCREMENT PRIMARY KEY,
  Name VARCHAR(100) NOT NULL,
  TargetType ENUM('User', 'Store', 'Order', 'System') NOT NULL,
  Channel ENUM('App', 'Email', 'SMS', 'LinePay') DEFAULT 'App',
  Title VARCHAR(200) NOT NULL,
  Body TEXT NOT NULL,
  IsActive TINYINT DEFAULT 1,
  CreatedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
  UpdatedAt DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;



-- NotificationLog
CREATE TABLE NotificationLog (
  LogID INT AUTO_INCREMENT PRIMARY KEY,
  UserID INT,
  TemplateID INT,
  SendStatus ENUM('Pending', 'Sent', 'Failed', 'Read') DEFAULT 'Pending',
  SentAt DATETIME DEFAULT CURRENT_TIMESTAMP,
  ReadAt DATETIME,
  Content TEXT,
  FOREIGN KEY (UserID) REFERENCES User(UserID),
  FOREIGN KEY (TemplateID) REFERENCES NotificationTemplate(TemplateID)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;




-- ========================================
-- 示例數據 - 用戶
-- ========================================
INSERT INTO User (Name, Email, Phone, PasswordHash, Role, IsActive) VALUES
('管理員', 'admin@campus.edu', '0912345678', 'admin123', 'SystemAdmin', 1),
('食堂A', 'storea@campus.edu', '0912345679', 'store123', 'ServiceProvider', 1),
('食堂B', 'storeb@campus.edu', '0912345680', 'store123', 'ServiceProvider', 1),
('學生A', 'student1@campus.edu', '0912345681', 'student123', 'EndUser', 1),
('學生B', 'student2@campus.edu', '0912345682', 'student123', 'EndUser', 1);

-- ========================================
-- 示例數據 - 商店
-- ========================================
INSERT INTO Store (VendorID, StoreName, Description, PhoneNumber, Address, OperatingHours, IsOpen) VALUES
(2, '校園食堂A', '提供中式快餐', '02-12345678', '台北市信義區校園路1號', '07:00-20:00', 1),
(3, '校園食堂B', '提供日式便當', '02-12345679', '台北市信義區校園路2號', '08:00-19:00', 1);

-- ========================================
-- 示例數據 - 菜單項
-- ========================================
INSERT INTO MenuItem (StoreID, ItemName, Description, Price, IsAvailable) VALUES
(1, '紅油炸醬麵', '經典炸醬麵搭配紅油', 45.00, 1),
(1, '滷肉飯', '台灣經典滷肉飯', 35.00, 1),
(1, '炒米粉', '香喷喷的炒米粉', 50.00, 1),
(2, '豚骨醬油便當', '日式豚骨醬油便當', 85.00, 1),
(2, '照燒雞腿便當', '日式照燒雞腿便當', 95.00, 1),
(2, '親子丼', '日式親子丼', 75.00, 1);

-- ========================================
-- 創建索引優化查詢
-- ========================================
CREATE INDEX idx_order_user_date ON Orders(UserID, CreatedAt);
CREATE INDEX idx_order_store_status ON Orders(StoreID, OrderStatus);
CREATE INDEX idx_menuitem_store_price ON MenuItem(StoreID, Price);

-- ========================================
-- 創建通知模板
-- ========================================

INSERT INTO NotificationTemplate (Name, TargetType, Channel, Title, Body, IsActive) VALUES
('新訂單通知', 'User', 'App', '您有新的訂單', '您的餐點已下單，請等待通知。', 1),
('訂單完成通知', 'User', 'App', '訂單完成', '您的訂單已完成，感謝使用。', 1),
('評論提醒', 'User', 'App', '請給予評價', '您的餐點已送達，歡迎撰寫評論。', 1);

-- ========================================
-- 創建通知日誌
-- ========================================
INSERT INTO NotificationLog (UserID, TemplateID, SendStatus, Content) VALUES
(4, 1, 'Sent', '您的餐點已下單，請等待通知。'),
(5, 2, 'Sent', '您的訂單已完成，感謝使用。');