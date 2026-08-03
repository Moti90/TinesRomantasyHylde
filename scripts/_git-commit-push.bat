@echo off
cd /d C:\Users\45313\Projects\tine-romantasy-db
git add -A
git status
git commit -F .git\COMMIT_MSG.txt
git push origin master
git status
