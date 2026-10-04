-- Stable Quollity person IDs match Zoos. No visits or personal history are seeded.
INSERT INTO people(id,display_name) VALUES
('0f780640-84b1-4aef-9374-823f600a4101','Michael'),
('86eb1a08-6d8e-419b-b08d-9b6bea8b1872','Jack');
INSERT INTO people_login_aliases(login_email,person_id) VALUES
('joker22hero@outlook.com','0f780640-84b1-4aef-9374-823f600a4101'),
('mhinz.mh22@gmail.com','0f780640-84b1-4aef-9374-823f600a4101'),
('jackzr@outlook.com','86eb1a08-6d8e-419b-b08d-9b6bea8b1872');
INSERT INTO place_types(id,slug,label,sort_order) VALUES
('botanic-garden','botanic-garden','Botanic garden',10),
('museum','museum','Museum',20),
('art-gallery','art-gallery','Art gallery',30),
('church','church','Church / cathedral',40),
('temple','temple','Temple / shrine',50),
('castle','castle','Castle / palace',60),
('historic-house','historic-house','Historic house',70),
('archaeological-site','archaeological-site','Archaeological site',80),
('monument','monument','Monument',90),
('scenic-attraction','scenic-attraction','Scenic attraction',100),
('park-garden','park-garden','Park / garden',110),
('aquarium','aquarium','Aquarium',120),
('theme-park','theme-park','Theme park',130),
('tour','tour','Tour',140),
('boat-trip','boat-trip','Cruise / boat trip',150),
('railway-cable-car','railway-cable-car','Railway / cable car',160),
('visitor-experience','visitor-experience','Visitor experience',170),
('other','other','Other',180);
