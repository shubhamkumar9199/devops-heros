#!/usr/bin/env bash
# Session 3 - Shell Scripting task
# Covers: variables, command substitution, reading input, creating a
# directory and a file, and writing process info into that file.
set -u

# ---- variables via command substitution ----
current_date=$(date)
host_name=$(hostname)
user_name=$(whoami)
session_count=$(who | wc -l)

echo "===== System information ====="
printf '%-12s %s\n' "Date:"     "$current_date"
printf '%-12s %s\n' "Hostname:" "$host_name"
printf '%-12s %s\n' "User:"     "$user_name"
printf '%-12s %s\n' "Sessions:" "$session_count logged-in session(s)"
echo

echo "===== Disk usage (root filesystem) ====="
df -h /
echo

# ---- take input from the user ----
read -rp "Enter your name: " name
read -rp "Enter your roll number: " roll_no
read -rp "Enter a comment: " comment
read -rp "Enter a directory name to create: " dir_name
read -rp "Enter a file name for the process log: " file_name
echo

# ---- create the directory and the process log inside it ----
mkdir -p "$dir_name"
ps -ef > "$dir_name/$file_name"

echo "===== Your details ====="
echo "My name is $name"
echo "My roll number is $roll_no"
echo "My comment is: $comment"
echo

echo "===== What the script created ====="
printf '%-12s %s\n' "Directory:" "$dir_name/"
printf '%-12s %s\n' "File:"      "$dir_name/$file_name ($(wc -l < "$dir_name/$file_name") lines)"
echo

echo "===== First 6 lines of $file_name ====="
head -6 "$dir_name/$file_name"
