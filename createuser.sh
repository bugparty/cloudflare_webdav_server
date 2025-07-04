#!/bin/bash

# 提示输入
read -p "Enter D1 database name: " DB_NAME
read -p "Enter username: " USERNAME
read -p "Enter hashed password: " HASHED_PASSWORD

# 执行插入命令
npx wrangler d1 execute "$DB_NAME" \
  --command "INSERT INTO user (username, password) VALUES ('$USERNAME', '$HASHED_PASSWORD')" \
  --remote
