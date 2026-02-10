# S3 document upload setup

The documents upload feature stores files in Amazon S3. If you see **Access Denied** when uploading, the server’s AWS identity does not have permission to write to the bucket.

## 1. Environment variables

Set these where the backend runs (e.g. `.env` or your host’s env):

- **`AWS_S3_BUCKET`** – Name of the S3 bucket (e.g. `my-app-documents`).
- **`AWS_REGION`** – Region of the bucket (e.g. `us-east-2`). Defaults to `us-east-2` if unset.

For credentials, use one of:

- **`AWS_ACCESS_KEY_ID`** and **`AWS_SECRET_ACCESS_KEY`** (IAM user), or  
- An **IAM role** (e.g. on EC2, ECS, or Lambda) so no access keys are needed.

## 2. Create the bucket (if needed)

In AWS Console: S3 → Create bucket → choose name and region. Use the same region as `AWS_REGION`.

## 3. IAM permissions

The identity used by the backend (user or role) must be allowed to read and write objects in that bucket.

**Minimum policy for upload + presigned preview:**

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "s3:PutObject",
        "s3:GetObject",
        "s3:DeleteObject"
      ],
      "Resource": "arn:aws:s3:::YOUR_BUCKET_NAME/*"
    }
  ]
}
```

Replace `YOUR_BUCKET_NAME` with the value of `AWS_S3_BUCKET`.

- **s3:PutObject** – required for uploads (fixes “Access Denied” on upload).
- **s3:GetObject** – required for presigned preview URLs.
- **s3:DeleteObject** – optional; only if you implement delete.

You do **not** need `s3:PutObjectAcl` unless you set ACLs on upload (this app does not).

## 4. Bucket policy (optional)

If the bucket is in another account or you need extra restrictions, use a bucket policy. For same-account IAM, the policy above on the **user/role** is enough.

## 5. Verify

1. Set `AWS_S3_BUCKET`, `AWS_REGION`, and credentials.
2. Restart the backend.
3. Upload a file again; the “Access Denied” error should stop once the IAM policy is attached to the correct identity.

If you deploy to Railway, Render, etc., set the same variables in the service’s environment (and ensure the platform’s runtime has valid AWS credentials if you use keys).
