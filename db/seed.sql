-- Placeholder designers. Edit names, emails, areas and Cal.com event type IDs
-- before going live. Run after db/0001_init.sql (Neon SQL Editor or psql).

insert into designers (name, email, areas, active, calcom_event_type_id) values
  ('Designer One',   'designer.one@example.com',   array['Kothrud', 'Karve Nagar', 'Warje', 'Bavdhan', 'Aundh', 'Baner', 'Pashan'], true, null),
  ('Designer Two',   'designer.two@example.com',   array['Wakad', 'Hinjewadi', 'Pimple Saudagar', 'Pimpri', 'Chinchwad', 'Ravet', 'Akurdi'], true, null),
  ('Designer Three', 'designer.three@example.com', array['Kharadi', 'Viman Nagar', 'Hadapsar', 'Magarpatta', 'Undri', 'Kondhwa', 'Wagholi', 'Koregaon Park'], true, null);
