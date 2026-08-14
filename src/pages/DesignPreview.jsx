// src/pages/DesignPreview.jsx
// Dev-витрина примитивов редизайна рядом с эталоном (design/reference.html).
// Доступна по /design-preview (ранний return в App.jsx, вне авторизации).
import React from "react";
import { Plus, ArrowUpRight, Pencil } from "lucide-react";
import {
  Pill,
  CircleBtn,
  AlertBadge,
  BlockCard,
  DarkSection,
  HeroNumber,
  BalanceCard,
  Chip,
} from "../components/ui/redesign.jsx";

function Section({ title, children }) {
  return (
    <div className="mb-10">
      <div className="text-[13px] text-muted mb-3.5 flex items-center gap-2.5">
        <b className="font-medium text-ink">{title}</b>
        <span className="flex-1 h-px bg-line-2" />
      </div>
      {children}
    </div>
  );
}

export default function DesignPreview() {
  return (
    <div className="min-h-screen bg-[#E5DECD] px-6 py-14 font-sans text-ink">
      <div className="max-w-[1100px] mx-auto">
        <h1 className="text-[26px] font-normal tracking-[-0.01em]">CoinPlata — примитивы редизайна</h1>
        <p className="text-[14px] text-muted mt-1.5 mb-10 max-w-[640px] leading-relaxed">
          Витрина переиспользуемых компонентов на новых токенах. Сверяется с{" "}
          <code className="font-mono text-[12px]">design/reference.html</code>. Onest, тёплый крем,
          тонкие цифры, круглые формы, тёмные секции.
        </p>

        <div className="rounded-screen bg-frame-glow bg-cream p-6">
          <Section title="Pill — таблетки">
            <div className="flex flex-wrap gap-2 items-center">
              <Pill variant="dark">Касса</Pill>
              <Pill variant="line">Счета</Pill>
              <Pill variant="lime">Принять</Pill>
              <Pill variant="warn">
                <span className="w-[7px] h-[7px] rounded-full bg-orange" />
                Черновик
              </Pill>
              <Pill variant="ghost">Настройки</Pill>
              <Pill variant="locked">Опубликовать v. 149</Pill>
            </div>
          </Section>

          <Section title="CircleBtn + AlertBadge">
            <div className="flex flex-wrap gap-3 items-center">
              <CircleBtn variant="dark">
                <ArrowUpRight className="w-[15px] h-[15px]" strokeWidth={1.8} />
              </CircleBtn>
              <CircleBtn variant="ring">
                <Pencil className="w-[14px] h-[14px]" strokeWidth={1.8} />
              </CircleBtn>
              <CircleBtn variant="light">
                <Plus className="w-[15px] h-[15px]" strokeWidth={1.8} />
              </CircleBtn>
              <span className="relative inline-flex">
                <CircleBtn variant="ring">
                  <Plus className="w-[14px] h-[14px]" strokeWidth={1.6} />
                </CircleBtn>
                <AlertBadge />
              </span>
            </div>
          </Section>

          <Section title="BlockCard — карточки блоков">
            <div className="grid grid-cols-3 gap-3">
              <BlockCard>
                <div className="text-[13px] text-muted mb-1">Нал · Толунай</div>
                <div className="flex items-baseline justify-between border-b border-line py-2.5">
                  <span className="text-[12.5px] text-muted">USD → TRY</span>
                  <HeroNumber value="40,88" size="row" />
                </div>
                <div className="flex items-baseline justify-between py-2.5">
                  <span className="text-[12.5px] text-muted">EUR → TRY</span>
                  <HeroNumber value="47,61" size="row" />
                </div>
              </BlockCard>

              <BlockCard variant="accent">
                <div className="flex items-start justify-between mb-4">
                  <span className="relative inline-flex">
                    <CircleBtn variant="ring" className="!border-blue-ink/40 !text-blue-ink" />
                    <AlertBadge />
                  </span>
                  <CircleBtn variant="light">
                    <ArrowUpRight className="w-[15px] h-[15px]" strokeWidth={1.8} />
                  </CircleBtn>
                </div>
                <div className="text-[13px] text-blue-soft mb-2.5">USDT · Paramon</div>
                <div className="flex gap-1.5">
                  <Chip on>ANT</Chip>
                  <Chip>IST</Chip>
                  <Chip>MSK</Chip>
                </div>
              </BlockCard>

              <BlockCard variant="add">
                <Plus className="w-4 h-4" strokeWidth={1.8} />
                Слот свободен
              </BlockCard>
            </div>
          </Section>

          <Section title="HeroNumber + BalanceCard">
            <div className="flex items-baseline gap-8 mb-4">
              <HeroNumber value="47,10" />
              <HeroNumber value="328 865,72" currency="USD" />
            </div>
            <div className="grid grid-cols-5 gap-2.5">
              <BalanceCard currency="USDT" value="14 196,10" sub="под заявки" />
              <BalanceCard currency="USD" value="22 975,18" sub="под заявки" />
              <BalanceCard currency="TRY" value="27 993" sub="под заявки" />
              <BalanceCard currency="EUR" empty sub="нет движений" />
              <BalanceCard currency="RUB" empty sub="нет движений" />
            </div>
          </Section>

          <Section title="DarkSection — тёмная секция">
            <DarkSection>
              <div className="flex items-center justify-between mb-3.5">
                <span className="text-[15px]">
                  Сделки<span className="text-[12px] text-[#7A7565] ml-2">24 за день</span>
                </span>
                <Pill variant="lime" className="!text-[12px] !px-4 !py-2">
                  Принять
                </Pill>
              </div>
              <div className="bg-dark-2 rounded-card-sm px-4 py-3 flex items-center justify-between">
                <span className="text-[13.5px]">@jussy_ju</span>
                <HeroNumber value="1 020" currency="USDT" size="row" />
              </div>
            </DarkSection>
          </Section>
        </div>
      </div>
    </div>
  );
}
