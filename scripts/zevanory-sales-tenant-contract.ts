import assert from 'node:assert/strict';
import {
  commercialBucketName,
  zevanorySalesTenantId,
  zevanorySalesTenantIsolation,
} from '../backend/commercial.ts';

const original = process.env.ZEVANORY_SALES_TENANT_ID;

try {
  delete process.env.ZEVANORY_SALES_TENANT_ID;
  assert.equal(zevanorySalesTenantId(), 'zevanory');
  assert.equal(commercialBucketName('lead'), 'zpc_commercial_leads');
  assert.deepEqual(zevanorySalesTenantIsolation(), {
    id: 'zevanory',
    defaultTenant: true,
    tenantSource: 'server-environment',
    isolation: 'server-owned-bucket-v1',
    clientSelectable: false,
  });

  process.env.ZEVANORY_SALES_TENANT_ID = 'cliente-acme';
  assert.equal(zevanorySalesTenantId(), 'cliente-acme');
  assert.equal(
    commercialBucketName('lead'),
    'zpc_commercial_leads__tenant_cliente-acme',
  );
  assert.equal(
    commercialBucketName('evidence'),
    'zpc_commercial_evidence__tenant_cliente-acme',
  );
  assert.equal(zevanorySalesTenantIsolation().clientSelectable, false);

  process.env.ZEVANORY_SALES_TENANT_ID = '../other';
  assert.throws(() => zevanorySalesTenantId(), /zevanory_sales_tenant_invalid/);

  process.env.ZEVANORY_SALES_TENANT_ID = 'a';
  assert.throws(() => commercialBucketName('lead'), /zevanory_sales_tenant_invalid/);

  console.log('ZEVANORY_SALES_TENANT_ID_SERVER_OWNED=PASS');
  console.log('ZEVANORY_SALES_DEFAULT_DATA_COMPATIBILITY=PASS');
  console.log('ZEVANORY_SALES_NONDEFAULT_BUCKET_ISOLATION=PASS');
  console.log('ZEVANORY_SALES_INVALID_TENANT_FAIL_CLOSED=PASS');
} finally {
  if (original === undefined) delete process.env.ZEVANORY_SALES_TENANT_ID;
  else process.env.ZEVANORY_SALES_TENANT_ID = original;
}
