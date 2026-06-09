import mysql from 'mysql2/promise'

const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '3306'),
  database: process.env.DB_NAME || 'rubber_db',
  user: process.env.DB_USER || 'rubber_user',
  password: process.env.DB_PASSWORD || 'rubber_db_2026',
  waitForConnections: true,
  connectionLimit: 10,
  charset: 'utf8mb4',
})

export default pool

export type DbExecutor = Pick<mysql.Pool, 'execute'> | mysql.PoolConnection

const getExecutor = (db?: DbExecutor) => db || pool

export async function query<T = any>(sql: string, params?: any[], db?: DbExecutor): Promise<T[]> {
  const [rows] = await getExecutor(db).execute(sql, params)
  return rows as T[]
}

export async function queryOne<T = any>(sql: string, params?: any[], db?: DbExecutor): Promise<T | null> {
  const rows = await query<T>(sql, params, db)
  return rows[0] || null
}

export async function execute(sql: string, params?: any[], db?: DbExecutor): Promise<{ insertId: number; affectedRows: number }> {
  const [result] = await getExecutor(db).execute(sql, params) as any
  return { insertId: result.insertId, affectedRows: result.affectedRows }
}

export async function withTransaction<T>(fn: (tx: mysql.PoolConnection) => Promise<T>): Promise<T> {
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    const result = await fn(conn)
    await conn.commit()
    return result
  } catch (error) {
    await conn.rollback()
    throw error
  } finally {
    conn.release()
  }
}
