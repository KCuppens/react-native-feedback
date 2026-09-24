-- The language the user's app last wrote in, so emails about their posts match it.
ALTER TABLE end_users ADD COLUMN locale TEXT;
