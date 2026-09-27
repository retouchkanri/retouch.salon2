-- オーナーズ会員: enum 値の追加（次の migration で plan 行と view を更新）
alter type member_plan_code add value if not exists 'OWNER';
