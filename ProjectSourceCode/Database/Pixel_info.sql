CREATE TABLE IF NOT EXISTS Pixels(
    pxl_num SERIAL PRIMARY KEY,
    red_value INT NOT NULL,
    green_value INT NOT NULL,
    blue_value INT NOT NULL
);