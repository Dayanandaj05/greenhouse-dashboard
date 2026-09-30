CREATE TABLE IF NOT EXISTS beds (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(60) NOT NULL,
  location VARCHAR(100) NOT NULL,
  crop VARCHAR(60) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS readings (
  id INT AUTO_INCREMENT PRIMARY KEY,
  bed_id INT NOT NULL,
  soil_moisture DECIMAL(5,2) NOT NULL,
  temperature DECIMAL(5,2) NOT NULL,
  humidity DECIMAL(5,2) NOT NULL,
  source ENUM('sensor','manual') NOT NULL DEFAULT 'manual',
  notes VARCHAR(255) NULL,
  recorded_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_readings_bed FOREIGN KEY (bed_id) REFERENCES beds(id) ON DELETE CASCADE,
  INDEX idx_bed_time (bed_id, recorded_at)
);

INSERT INTO beds (name, location, crop) VALUES
 ('Bed A1', 'Greenhouse 1 - North', 'Tomatoes'),
 ('Bed A2', 'Greenhouse 1 - South', 'Spinach'),
 ('Bed B1', 'Greenhouse 2 - East', 'Chillies'),
 ('Bed B2', 'Greenhouse 2 - West', 'Lettuce');

INSERT INTO readings (bed_id, soil_moisture, temperature, humidity, source, recorded_at) VALUES
 (1, 55.2, 26.4, 68.0, 'sensor', NOW() - INTERVAL 30 MINUTE),
 (1, 52.8, 26.9, 66.5, 'sensor', NOW() - INTERVAL 15 MINUTE),
 (2, 41.0, 24.1, 72.3, 'sensor', NOW() - INTERVAL 25 MINUTE),
 (2, 39.5, 24.4, 71.0, 'manual', NOW() - INTERVAL 10 MINUTE),
 (3, 28.7, 29.8, 58.2, 'sensor', NOW() - INTERVAL 20 MINUTE),
 (3, 27.9, 30.2, 57.6, 'sensor', NOW() - INTERVAL 5 MINUTE),
 (4, 63.4, 22.5, 77.9, 'sensor', NOW() - INTERVAL 18 MINUTE),
 (4, 0.00, 59.90, 12.0, 'sensor', NOW() - INTERVAL 2 MINUTE);
