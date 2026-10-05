/**
 * Los comercios demo (#24), para excluirlos de cobro, plataforma, impersonación y backup: los fijos
 * de M8 y, hasta que el barrido los borre, los tenants por visitante de #9.
 */
export const DEMO_TENANT_IDS_SQL = '(SELECT tenant_id FROM demo_tenants UNION SELECT tenant_id FROM legacy_demo_sessions)';
