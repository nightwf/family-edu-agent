# 对象存储

教材文件使用 S3 兼容对象存储。开发环境默认使用 Docker Compose 中的 MinIO，生产环境通过环境变量切换到腾讯云 COS。

## 环境变量

```text
S3_ENDPOINT=cos.ap-shanghai.myqcloud.com
S3_ACCESS_KEY=<SecretId>
S3_SECRET_KEY=<SecretKey>
S3_BUCKET=family-edu-files
S3_USE_SSL=true
```

MinIO 开发环境：

```text
S3_ENDPOINT=minio
S3_ACCESS_KEY=minioadmin
S3_SECRET_KEY=minioadmin
S3_BUCKET=family-edu-files
S3_USE_SSL=false
```

数据库只保存 `fileKey`，文件本体保存在对象存储中。
