#!/bin/bash
cd "C:/Users/MT-Staff/Documents/GitHub/nd-dsh"
for i in 1 2 3; do
  echo "=== ATTEMPT $i ==="
  TODO_MODEL=stealth/ox-alpha TODO_TARGET_WS="C:\Users\MT-Staff\Documents\nd-dsh-qa\todo-fullstack" node e2e/__fullstack-todo-long.mjs
  code=$?
  if [ $code -eq 0 ]; then exit 0; fi
  if grep -q "terminal:" <<< "$(cat /tmp/beta-attempt.out 2>/dev/null)"; then :; fi
  # A launch failure happens within ~3 min; a real pipeline run lasts much longer.
  sleep 10
done
exit $code
