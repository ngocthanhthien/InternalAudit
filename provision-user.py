"""Create SQL locally; password is prompted without echo, never put in command history."""
import base64, getpass, hashlib, secrets, sys
from pathlib import Path
if len(sys.argv) not in (4,5) or sys.argv[3] not in ('admin','auditor','pic','auditee'):
    raise SystemExit('python provision-user.py ACCOUNT_ID "Display name" admin|auditor|pic [--gate]')
gate=len(sys.argv)==5 and sys.argv[4]=='--gate'
if len(sys.argv)==5 and (not gate or sys.argv[1]!='QA' or sys.argv[3]!='admin'):
    raise SystemExit('--gate is only for QA admin (the entry account).')
role='auditee' if sys.argv[3]=='pic' else sys.argv[3]
password=getpass.getpass('Password: ')
if not password: raise SystemExit('Password cannot be empty.')
if password!=getpass.getpass('Repeat password: '): raise SystemExit('Passwords differ.')
salt=secrets.token_bytes(16)
b64=lambda data:base64.urlsafe_b64encode(data).decode().rstrip('=')
digest=hashlib.pbkdf2_hmac('sha256',password.encode(),salt,100000)
stored=f'pbkdf2:100000:{b64(salt)}:{b64(digest)}'
quote=lambda value:"'"+value.replace("'","''")+"'"
table='users' if gate else 'members'
sql='INSERT INTO '+table+'(id,name,role,password_hash) VALUES('+','.join(map(quote,[sys.argv[1],sys.argv[2],role,stored]))+');\n'
with Path('accounts.sql').open('a',encoding='utf-8') as out:out.write(sql)
print('Added account to accounts.sql (git-ignored). Apply it to your own D1 database.')
