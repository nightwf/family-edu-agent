# 数据库备份

## 手动备份

```bash
cd /opt/family-edu-agent
./deploy/backup.sh
```

备份文件保存在 `/opt/family-edu-agent/backups`，保留 14 天。

## 定时备份

在服务器 root 用户下执行：

```bash
crontab -e
```

增加：

```cron
0 2 * * * cd /opt/family-edu-agent && ./deploy/backup.sh
```

## 恢复

```bash
zcat backups/family_edu_20260815-020000.sql.gz | docker compose exec -T db psql -U family_edu -d family_edu
```
