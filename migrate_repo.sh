#!/bin/bash
git remote set-url origin https://github.com/sheepbun/yips.git 2>/dev/null || git remote add origin https://github.com/sheepbun/yips.git
git push -u origin HEAD
