'use client'
import { apiFetch, API } from './api'

export type CompanySettings = {
  id: number
  company_name: string
  company_name_local: string
  address: string
  phone: string
  contact_person: string
  email: string
  tax_id: string
  logo_url: string | null
  signature_url: string | null
}

const DEFAULT: CompanySettings = {
  id: 1,
  company_name: 'FAN YONG CO., LTD',
  company_name_local: 'CÔNG TY TNHH FAN YONG VIỆT NAM',
  address: '152 Hà Huy Tập, P. Tân Hưng, TP. HCM',
  phone: '0909883372 Danny Lin / 0909042239 Mỹ Linh',
  contact_person: 'Danny Lin / Mỹ Linh Ellachen',
  email: '',
  tax_id: '',
  logo_url: null,
  signature_url: null,
}

let _cache: CompanySettings | null = null

export async function getCompany(): Promise<CompanySettings> {
  if (_cache) return _cache
  try {
    const data = await apiFetch<CompanySettings>('/api/company')
    _cache = { ...DEFAULT, ...data }
    return _cache
  } catch {
    return DEFAULT
  }
}

export function clearCompanyCache() { _cache = null }

/** Get full logo URL (handles relative paths) */
export function getLogoUrl(company: CompanySettings): string | null {
  if (!company.logo_url) return null
  return company.logo_url.startsWith('http') ? company.logo_url : `${API}${company.logo_url}`
}

export function getCompanySignatureUrl(company: CompanySettings): string | null {
  if (!company.signature_url) return null
  return company.signature_url.startsWith('http') ? company.signature_url : `${API}${company.signature_url}`
}
