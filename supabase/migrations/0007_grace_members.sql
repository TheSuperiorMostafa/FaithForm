-- FaithForm: replace placeholder Grace Community Church members with real roster
-- Migration 0007

-- Remove seed placeholder members (safe: attendance_entries.member_id is ON DELETE SET NULL)
delete from public.members
where id in (
  '22222222-2222-2222-2222-222222222221',
  '22222222-2222-2222-2222-222222222222',
  '22222222-2222-2222-2222-222222222223',
  '22222222-2222-2222-2222-222222222224',
  '22222222-2222-2222-2222-222222222225'
);

-- Insert real Grace Community Church members (idempotent on church_id + name)
insert into public.members (church_id, first_name, last_name)
select v.church_id, v.first_name, v.last_name
from (
  values
    ('11111111-1111-1111-1111-111111111111'::uuid, 'Andrew', 'Archer'),
    ('11111111-1111-1111-1111-111111111111'::uuid, 'Joel', 'Archer'),
    ('11111111-1111-1111-1111-111111111111'::uuid, 'Les', 'Archer'),
    ('11111111-1111-1111-1111-111111111111'::uuid, 'Mary Ann', 'Archer'),
    ('11111111-1111-1111-1111-111111111111'::uuid, 'Philip', 'Archer'),
    ('11111111-1111-1111-1111-111111111111'::uuid, 'Bonnie', 'Baugher'),
    ('11111111-1111-1111-1111-111111111111'::uuid, 'Michael', 'Baugher'),
    ('11111111-1111-1111-1111-111111111111'::uuid, 'Mima', 'Beams'),
    ('11111111-1111-1111-1111-111111111111'::uuid, 'Wes', 'Beams'),
    ('11111111-1111-1111-1111-111111111111'::uuid, 'Wes', 'Dupin'),
    ('11111111-1111-1111-1111-111111111111'::uuid, 'Bruce', 'Graham'),
    ('11111111-1111-1111-1111-111111111111'::uuid, 'Tara', 'Graham'),
    ('11111111-1111-1111-1111-111111111111'::uuid, 'Pam', 'Green'),
    ('11111111-1111-1111-1111-111111111111'::uuid, 'Mary B.', 'Griffith'),
    ('11111111-1111-1111-1111-111111111111'::uuid, 'Daniel', 'Henderson'),
    ('11111111-1111-1111-1111-111111111111'::uuid, 'Kathy', 'Henderson'),
    ('11111111-1111-1111-1111-111111111111'::uuid, 'Jack', 'Hopkins'),
    ('11111111-1111-1111-1111-111111111111'::uuid, 'Ruth', 'Hopkins'),
    ('11111111-1111-1111-1111-111111111111'::uuid, 'Aimee', 'Kincaid'),
    ('11111111-1111-1111-1111-111111111111'::uuid, 'Kristopher', 'Kincaid'),
    ('11111111-1111-1111-1111-111111111111'::uuid, 'Nadelynn', 'Kincaid'),
    ('11111111-1111-1111-1111-111111111111'::uuid, 'Nayden', 'Kincaid'),
    ('11111111-1111-1111-1111-111111111111'::uuid, 'Noelle', 'Kincaid'),
    ('11111111-1111-1111-1111-111111111111'::uuid, 'Cameron', 'Keltner'),
    ('11111111-1111-1111-1111-111111111111'::uuid, 'Danielle', 'Keltner'),
    ('11111111-1111-1111-1111-111111111111'::uuid, 'Ember', 'Keltner'),
    ('11111111-1111-1111-1111-111111111111'::uuid, 'Jacob', 'Keltner'),
    ('11111111-1111-1111-1111-111111111111'::uuid, 'Thomas', 'Keltner'),
    ('11111111-1111-1111-1111-111111111111'::uuid, 'Aaron', 'Lemaster'),
    ('11111111-1111-1111-1111-111111111111'::uuid, 'Ashley', 'Lemaster'),
    ('11111111-1111-1111-1111-111111111111'::uuid, 'Bridget', 'Levsey'),
    ('11111111-1111-1111-1111-111111111111'::uuid, 'Steve', 'Levsey'),
    ('11111111-1111-1111-1111-111111111111'::uuid, 'Todd', 'Lithe'),
    ('11111111-1111-1111-1111-111111111111'::uuid, 'Madelyn', 'McDonald'),
    ('11111111-1111-1111-1111-111111111111'::uuid, 'Audrey', 'McWhorter'),
    ('11111111-1111-1111-1111-111111111111'::uuid, 'Barbara', 'McWhorter'),
    ('11111111-1111-1111-1111-111111111111'::uuid, 'Michael', 'McWhorter'),
    ('11111111-1111-1111-1111-111111111111'::uuid, 'Brent', 'Piatt'),
    ('11111111-1111-1111-1111-111111111111'::uuid, 'Heather', 'Piatt'),
    ('11111111-1111-1111-1111-111111111111'::uuid, 'Kaylee', 'Piatt'),
    ('11111111-1111-1111-1111-111111111111'::uuid, 'Sean', 'Piatt'),
    ('11111111-1111-1111-1111-111111111111'::uuid, 'JonBrent', 'Piatt'),
    ('11111111-1111-1111-1111-111111111111'::uuid, 'Christine', 'Pruitt'),
    ('11111111-1111-1111-1111-111111111111'::uuid, 'Janet', 'Riddle'),
    ('11111111-1111-1111-1111-111111111111'::uuid, 'John', 'Riddle'),
    ('11111111-1111-1111-1111-111111111111'::uuid, 'Arnold', 'Seligman'),
    ('11111111-1111-1111-1111-111111111111'::uuid, 'Andrew', 'Shader'),
    ('11111111-1111-1111-1111-111111111111'::uuid, 'Mark', 'Shader'),
    ('11111111-1111-1111-1111-111111111111'::uuid, 'Carolyn', 'Smith'),
    ('11111111-1111-1111-1111-111111111111'::uuid, 'Sandy', 'Smith'),
    ('11111111-1111-1111-1111-111111111111'::uuid, 'Adam', 'Steele'),
    ('11111111-1111-1111-1111-111111111111'::uuid, 'Teresa', 'Sowders'),
    ('11111111-1111-1111-1111-111111111111'::uuid, 'Roxie', 'Voyles'),
    ('11111111-1111-1111-1111-111111111111'::uuid, 'Todd', 'Willie'),
    ('11111111-1111-1111-1111-111111111111'::uuid, 'Bart', 'Wilson'),
    ('11111111-1111-1111-1111-111111111111'::uuid, 'Dave', 'Wills'),
    ('11111111-1111-1111-1111-111111111111'::uuid, 'Tammy', 'Wills')
) as v (church_id, first_name, last_name)
where not exists (
  select 1
  from public.members m
  where m.church_id = v.church_id
    and m.first_name = v.first_name
    and m.last_name = v.last_name
);
