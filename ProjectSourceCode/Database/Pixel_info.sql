CREATE TABLE IF NOT EXISTS Pixels(
    pxl_num SERIAL PRIMARY KEY,
    red_value INT NOT NULL,
    green_value INT NOT NULL,
    blue_value INT NOT NULL
);

CREATE TABLE IF NOT EXISTS Players(
    player_id SERIAL PRIMARY KEY,
    username VARCHAR(60) UNIQUE,
    password VARCHAR(50) NOT NULL
);