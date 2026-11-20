import { query, withTransaction } from '../lib/db';
import { isFeatureKey, type FeatureGrantMap, type FeatureKey } from '../modules/rbac/features';

/**
 * 账号级功能开关的读写（表见 migration 20261120120000_employee_feature_grants）。
 * 缺省（没有行）= 继承角色基线；行只在显式开关时存在。
 */
export type EmployeeFeatureGrantRow = {
  employeeId: string;
  feature: string;
  allowed: boolean;
  updatedAt: Date;
  updatedBy: string | null;
};

type GrantRow = {
  employee_id: string;
  feature: string;
  allowed: boolean;
  updated_at: Date;
  updated_by: string | null;
};

export async function listByEmployee(
  employeeId: string,
): Promise<EmployeeFeatureGrantRow[]> {
  const rows = await query<GrantRow>(
    `SELECT employee_id, feature, allowed, updated_at, updated_by
       FROM employee_feature_grants
      WHERE employee_id = $1
      ORDER BY feature`,
    [employeeId],
  );
  return rows.map((row) => ({
    employeeId: row.employee_id,
    feature: row.feature,
    allowed: row.allowed,
    updatedAt: row.updated_at,
    updatedBy: row.updated_by,
  }));
}

/** 守卫/会话用的紧凑映射；未知 key（旧版本残留）忽略 = 继承基线（fail-closed）。 */
export async function mapForEmployee(
  employeeId: string,
): Promise<FeatureGrantMap> {
  const rows = await listByEmployee(employeeId);
  const map = new Map<FeatureKey, boolean>();
  for (const row of rows) {
    if (isFeatureKey(row.feature)) map.set(row.feature, row.allowed);
  }
  return map;
}

/**
 * 全量替换某员工的显式开关（PUT 语义，幂等）：先清空，再写入本次提交的行。
 * 事务保证并发读不会看到中间状态。
 */
export async function replaceForEmployee(
  employeeId: string,
  grants: ReadonlyArray<{ feature: FeatureKey; allowed: boolean }>,
  updatedBy: string | null,
): Promise<void> {
  await withTransaction(async (client) => {
    await client.query(
      `DELETE FROM employee_feature_grants WHERE employee_id = $1`,
      [employeeId],
    );
    if (grants.length === 0) return;
    await client.query(
      `INSERT INTO employee_feature_grants
         (employee_id, feature, allowed, updated_by)
       SELECT $1, feature, allowed, $4
         FROM unnest($2::text[], $3::boolean[]) AS input(feature, allowed)`,
      [
        employeeId,
        grants.map((grant) => grant.feature),
        grants.map((grant) => grant.allowed),
        updatedBy,
      ],
    );
  });
}

/** 清空某员工的全部显式开关（回到角色基线）。 */
export async function clearForEmployee(employeeId: string): Promise<void> {
  await query(`DELETE FROM employee_feature_grants WHERE employee_id = $1`, [
    employeeId,
  ]);
}

/**
 * 其它「可用的账号管理员」数量：Active + Verified 的 Admin，
 * 且没有显式关闭 module.accounts。最后一个可用管理员保护用。
 */
export async function countOtherAccountsCapableAdmins(
  employeeId: string,
): Promise<number> {
  const rows = await query<{ count: number }>(
    `SELECT COUNT(*)::int AS count
       FROM employees e
      WHERE e.employee_id <> $1
        AND e.role = 'ADMIN'
        AND e.account_status = 'ACTIVE'
        AND e.email_verification = 'VERIFIED'
        AND NOT EXISTS (
          SELECT 1 FROM employee_feature_grants g
           WHERE g.employee_id = e.employee_id
             AND g.feature = 'module.accounts'
             AND g.allowed = false
        )`,
    [employeeId],
  );
  return rows[0]?.count ?? 0;
}
