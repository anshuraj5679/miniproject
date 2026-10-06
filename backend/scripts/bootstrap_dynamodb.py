from __future__ import annotations

import time

import boto3
from botocore.exceptions import ClientError

from app.core.config import get_settings


def _ensure_table(
    *,
    client,
    table_name: str,
    hash_key: str,
    user_index_name: str,
    merchant_index_name: str,
) -> None:
    if not table_name:
        raise RuntimeError("Table name is required.")

    try:
        client.describe_table(TableName=table_name)
        print(f"[exists] {table_name}")
        return
    except ClientError as exc:
        error_code = str(exc.response.get("Error", {}).get("Code") or "")
        if error_code != "ResourceNotFoundException":
            raise

    print(f"[create] {table_name}")
    client.create_table(
        TableName=table_name,
        BillingMode="PAY_PER_REQUEST",
        AttributeDefinitions=[
            {"AttributeName": hash_key, "AttributeType": "S"},
            {"AttributeName": "user_id", "AttributeType": "S"},
            {"AttributeName": "merchant_user_id", "AttributeType": "S"},
            {"AttributeName": "created_at", "AttributeType": "S"},
        ],
        KeySchema=[{"AttributeName": hash_key, "KeyType": "HASH"}],
        GlobalSecondaryIndexes=[
            {
                "IndexName": user_index_name,
                "KeySchema": [
                    {"AttributeName": "user_id", "KeyType": "HASH"},
                    {"AttributeName": "created_at", "KeyType": "RANGE"},
                ],
                "Projection": {"ProjectionType": "ALL"},
            },
            {
                "IndexName": merchant_index_name,
                "KeySchema": [
                    {"AttributeName": "merchant_user_id", "KeyType": "HASH"},
                    {"AttributeName": "created_at", "KeyType": "RANGE"},
                ],
                "Projection": {"ProjectionType": "ALL"},
            },
        ],
    )

    waiter = client.get_waiter("table_exists")
    waiter.wait(TableName=table_name)
    time.sleep(1)
    print(f"[ready] {table_name}")


def main() -> None:
    settings = get_settings()
    if not settings.dynamodb_documents_table_name or not settings.dynamodb_extraction_jobs_table_name:
        raise RuntimeError(
            "Set DYNAMODB_DOCUMENTS_TABLE_NAME and DYNAMODB_EXTRACTION_JOBS_TABLE_NAME before bootstrapping."
        )

    client = boto3.client("dynamodb", region_name=settings.aws_region)
    _ensure_table(
        client=client,
        table_name=settings.dynamodb_documents_table_name,
        hash_key="doc_id",
        user_index_name=settings.dynamodb_user_created_at_index_name,
        merchant_index_name=settings.dynamodb_merchant_created_at_index_name,
    )
    _ensure_table(
        client=client,
        table_name=settings.dynamodb_extraction_jobs_table_name,
        hash_key="job_id",
        user_index_name=settings.dynamodb_user_created_at_index_name,
        merchant_index_name=settings.dynamodb_merchant_created_at_index_name,
    )


if __name__ == "__main__":
    main()
