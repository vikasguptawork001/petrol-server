-- Exported users table (structure + data)
-- Database: u812625986_steepwholesale
-- Date: 2026-02-20T05:13:17.508Z

USE `u812625986_steepwholesale`;

DROP TABLE IF EXISTS `users`;
CREATE TABLE `users` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `user_id` varchar(50) NOT NULL,
  `password` varchar(255) NOT NULL,
  `role` enum('super_admin','admin','sales') NOT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `user_id` (`user_id`)
) ENGINE=InnoDB AUTO_INCREMENT=6 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

INSERT INTO `users` (`id`, `user_id`, `password`, `role`, `created_at`, `updated_at`) VALUES (1, 'superadmin', '$2a$10$SmudmB9qhS2GiCBxCIcjFOk1Hnvmdbijoz7Ea41NSE68a24LbYc5W', 'super_admin', 'Fri Jan 02 2026 04:19:19 GMT+0530 (India Standard Time)', 'Fri Jan 02 2026 04:19:19 GMT+0530 (India Standard Time)');
INSERT INTO `users` (`id`, `user_id`, `password`, `role`, `created_at`, `updated_at`) VALUES (2, 'admin1', '$2a$10$pREICtmPiw7WnK/ovDCVceJzHDegXDEAzUWsHOrofNQXMTZ4RcYyu', 'admin', 'Sat Jan 03 2026 04:58:41 GMT+0530 (India Standard Time)', 'Fri Jan 09 2026 13:00:55 GMT+0530 (India Standard Time)');
INSERT INTO `users` (`id`, `user_id`, `password`, `role`, `created_at`, `updated_at`) VALUES (4, 'admin', '$2a$10$pREICtmPiw7WnK/ovDCVceJzHDegXDEAzUWsHOrofNQXMTZ4RcYyu', 'admin', 'Sat Jan 03 2026 05:07:32 GMT+0530 (India Standard Time)', 'Sat Jan 03 2026 05:07:32 GMT+0530 (India Standard Time)');
INSERT INTO `users` (`id`, `user_id`, `password`, `role`, `created_at`, `updated_at`) VALUES (5, 'sales', '$2a$10$WHdga709Bqu2hhswybdwQOOCttCD09V.ZuwZ/28bcgUuafZk0sR9u', 'sales', 'Sat Jan 03 2026 05:31:31 GMT+0530 (India Standard Time)', 'Sat Jan 03 2026 05:31:31 GMT+0530 (India Standard Time)');
