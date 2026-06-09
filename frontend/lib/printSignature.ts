import { type CompanySettings } from './useCompany'

const DEFAULT_WIDTH = 220
const DEFAULT_HEIGHT = 72

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

export function getPrintSignatureConfig(company?: Partial<CompanySettings> | null) {
  const width = clamp(Number(company?.signature_print_width) || DEFAULT_WIDTH, 120, 320)
  const height = clamp(Number(company?.signature_print_height) || DEFAULT_HEIGHT, 48, 140)
  const areaMinHeight = Math.max(80, height + 20)

  return {
    width,
    height,
    areaMinHeight,
    imgStyle: `max-height:${height}px;max-width:${width}px;object-fit:contain`,
  }
}
