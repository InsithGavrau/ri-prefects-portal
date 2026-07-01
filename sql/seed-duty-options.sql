begin;

insert into public.duty_types(name) values
  ('Checkpoint Duty'),('Floor Duty'),('Canteen Duty')
on conflict (name) do update set is_active=true, active=true;

with seed(type_name, location_name, group_name, sort_order) as (values
  ('Canteen Duty','Canteen',null,10),
  ('Floor Duty','1NA','Ground Floor - Old Building',101),
  ('Floor Duty','1NB','Ground Floor - Old Building',102),
  ('Floor Duty','2N','Ground Floor - Old Building',103),
  ('Floor Duty','3NA','Ground Floor - Old Building',104),
  ('Floor Duty','3NB','Ground Floor - Old Building',105),
  ('Floor Duty','3CA','1st Floor - Old Building',201),
  ('Floor Duty','3CB','1st Floor - Old Building',202),
  ('Floor Duty','3CC','1st Floor - Old Building',203),
  ('Floor Duty','4NA','1st Floor - Old Building',204),
  ('Floor Duty','4NB','1st Floor - Old Building',205),
  ('Floor Duty','5NA','1st Floor - Old Building',206),
  ('Floor Duty','5NB','1st Floor - Old Building',207),
  ('Floor Duty','Staircase','1st Floor - Old Building',208),
  ('Floor Duty','10NA','1st Floor - New Building',301),
  ('Floor Duty','10NB','1st Floor - New Building',302),
  ('Floor Duty','11NA','1st Floor - New Building',303),
  ('Floor Duty','11NB','1st Floor - New Building',304),
  ('Floor Duty','Staircase','1st Floor - New Building',305),
  ('Floor Duty','1CA','1st Floor - New New Building',401),
  ('Floor Duty','1CB','1st Floor - New New Building',402),
  ('Floor Duty','1CC','1st Floor - New New Building',403),
  ('Floor Duty','2CA','1st Floor - New New Building',404),
  ('Floor Duty','2CB','1st Floor - New New Building',405),
  ('Floor Duty','2CC','1st Floor - New New Building',406),
  ('Floor Duty','4CA','2nd Floor - Old Building',501),
  ('Floor Duty','4CB','2nd Floor - Old Building',502),
  ('Floor Duty','5CA','2nd Floor - Old Building',503),
  ('Floor Duty','5CB','2nd Floor - Old Building',504),
  ('Floor Duty','6NA','2nd Floor - Old Building',505),
  ('Floor Duty','6NB','2nd Floor - Old Building',506),
  ('Floor Duty','7NA','2nd Floor - Old Building',507),
  ('Floor Duty','7NB','2nd Floor - Old Building',508),
  ('Floor Duty','Staircase','2nd Floor - Old Building',509),
  ('Floor Duty','8NA','2nd Floor - New Building',601),
  ('Floor Duty','8NB','2nd Floor - New Building',602),
  ('Floor Duty','9NA','2nd Floor - New Building',603),
  ('Floor Duty','9NB','2nd Floor - New Building',604),
  ('Floor Duty','Staircase','2nd Floor - New Building',605),
  ('Floor Duty','11 Edexcel','2nd Floor - New New Building',701),
  ('Floor Duty','12 Edexcel','2nd Floor - New New Building',702),
  ('Floor Duty','6CA','3rd Floor - New Building',801),
  ('Floor Duty','6CB','3rd Floor - New Building',802),
  ('Floor Duty','8NC','3rd Floor - New Building',803),
  ('Floor Duty','7CB','3rd Floor - New Building',804),
  ('Floor Duty','Staircase','3rd Floor - New Building',805),
  ('Floor Duty','10CA','3rd Floor - New New Building',901),
  ('Floor Duty','9CA','3rd Floor - New New Building',902),
  ('Floor Duty','12N Art/Commerce','3rd Floor - New New Building',903),
  ('Floor Duty','12N Sci./Math','3rd Floor - New New Building',904),
  ('Floor Duty','13N Art/Commerce','3rd Floor - New New Building',905),
  ('Floor Duty','7CA','3rd Floor - New New Building',906),
  ('Floor Duty','13N Sci./Math','3rd Floor - New New Building',907),
  ('Floor Duty','Staircase','3rd Floor - New New Building',908),
  ('Floor Duty','8CA','4th Floor - New Building',1001),
  ('Floor Duty','8CB','4th Floor - New Building',1002),
  ('Floor Duty','10CB','4th Floor - New Building',1003),
  ('Floor Duty','9CB','4th Floor - New Building',1004),
  ('Floor Duty','Staircase','4th Floor - New Building',1005),
  ('Floor Duty','Old/New/New New Building 1st Floor Corridor','Special corridor',1100)
)
insert into public.duty_locations(duty_type_id,name,group_name,sort_order)
select dt.id,seed.location_name,seed.group_name,seed.sort_order
from seed join public.duty_types dt on dt.name=seed.type_name
on conflict (duty_type_id,name,group_name) do update set is_active=true, sort_order=excluded.sort_order;

commit;
