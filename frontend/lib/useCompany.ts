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
  signature_print_width: number
  signature_print_height: number
  notification_email: string
}

export const DEFAULT_COMPANY_NAME = 'KUNYI CO., LTD'
export const DEFAULT_COMPANY_NAME_LOCAL = 'CÔNG TY TNHH KUNYI VIỆT NAM'

export const EMPTY_COMPANY_SETTINGS: CompanySettings = {
  id: 1,
  company_name: '',
  company_name_local: '',
  address: '',
  phone: '',
  contact_person: '',
  email: '',
  tax_id: '',
  logo_url: null,
  signature_url: null,
  signature_print_width: 220,
  signature_print_height: 72,
  notification_email: '',
}

export const FALLBACK_COMPANY_SETTINGS: CompanySettings = {
  ...EMPTY_COMPANY_SETTINGS,
  company_name: DEFAULT_COMPANY_NAME,
  company_name_local: DEFAULT_COMPANY_NAME_LOCAL,
}

let _cache: CompanySettings | null = null

export function getCompanyDisplayName(
  company?: Partial<CompanySettings> | null,
  fallback = DEFAULT_COMPANY_NAME,
): string {
  const name = company?.company_name?.trim()
  if (name) return name
  const local = company?.company_name_local?.trim()
  if (local) return local
  return fallback
}

export function getCompanyInitial(
  company?: Partial<CompanySettings> | null,
  fallback = 'K',
): string {
  const name = getCompanyDisplayName(company)
  if (!name) return fallback
  return name.charAt(0).toUpperCase()
}

export function resolveCompanySettings(
  company?: Partial<CompanySettings> | null,
): CompanySettings {
  const merged = { ...EMPTY_COMPANY_SETTINGS, ...company }
  if (!merged.company_name?.trim()) merged.company_name = DEFAULT_COMPANY_NAME
  if (!merged.company_name_local?.trim()) merged.company_name_local = DEFAULT_COMPANY_NAME_LOCAL
  return merged
}

export async function getCompany(): Promise<CompanySettings> {
  if (_cache) return _cache
  try {
    const data = await apiFetch<CompanySettings>('/api/company')
    _cache = resolveCompanySettings(data)
    return _cache
  } catch {
    return FALLBACK_COMPANY_SETTINGS
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
