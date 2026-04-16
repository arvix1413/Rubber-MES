ALTER TABLE company_settings
  ADD COLUMN operating_cost_rate DECIMAL(8,4) NOT NULL DEFAULT 0 COMMENT '營運成本比例(%)',
  ADD COLUMN vat_rate DECIMAL(8,4) NOT NULL DEFAULT 0 COMMENT '營業稅比例(%)',
  ADD COLUMN cit_rate DECIMAL(8,4) NOT NULL DEFAULT 0 COMMENT '所得稅比例(%)';
