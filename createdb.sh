DB_NAME="s3acl"
npx wrangler d1 execute "$DB_NAME" --command "CREATE TABLE user (id INTEGER PRIMARY KEY NOT NULL, username STRING NOT NULL, password STRING NOT NULL)" --remote
npx wrangler d1 execute "$DB_NAME" --command "CREATE UNIQUE INDEX user_username ON user (username)"  --remote
