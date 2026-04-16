import mysql from 'mysql2/promise'

const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '3306'),
  database: process.env.DB_NAME || 'oms_db',
  user: process.env.DB_USER || 'oms_user',
  password: process.env.DB_PASSWORD || 'oms_db_2026',
  waitForConnections: true,
  connectionLimit: 10,
  charset: 'utf8mb4',
})

export default pool

export async function query<T = any>(sql: string, params?: any[]): Promise<T[]> {
  const [rows] = await pool.execute(sql, params)
  return rows as T[]
}

export async function queryOne<T = any>(sql: string, params?: any[]): Promise<T | null> {
  const rows = await query<T>(sql, params)
  return rows[0] || null
}

export async function execute(sql: string, params?: any[]): Promise<{ insertId: number; affectedRows: number }> {
  const [result] = await pool.execute(sql, params) as any
  return { insertId: result.insertId, affectedRows: result.affectedRows }
}
