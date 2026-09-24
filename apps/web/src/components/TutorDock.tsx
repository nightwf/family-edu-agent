import { useEffect, useState } from "react";
import { Sparkles } from "lucide-react";
import TutorChat from "./TutorChat";

type Child = { id: string; name: string; grade?: string; gender?: string };

type Props = {
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
  token: string;
  apiBase: string;
  children: Child[];
  request: (path: string, options?: RequestInit, token?: string) => Promise<any>;
};

/**
 * 学习私教的浮窗入口。
 *
 * 之前私教是侧边栏里的一个整页，手机上侧边栏收在抽屉里，家长和孩子
 * 根本找不到入口。改成常驻的浮窗：右下角一个按钮，点开就是对话窗口，
 * 不离开当前页面。
 *
 * 对话本身仍然是 TutorChat，浮窗只负责容器和开关，所以整页形态与浮窗
 * 形态共用同一套逻辑，不会出现两边行为不一致。
 */
export default function TutorDock({ open, onOpen, onClose, token, apiBase, children, request }: Props) {
  /**
   * 首次打开才挂载对话。
   * TutorChat 一挂载就会打开（没有就新建）会话，提前挂载等于每次进页面
   * 都白建一条会话；关掉时卸载，顺带让语音钩子把麦克风和播放收干净。
   */
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    if (open) setMounted(true);
  }, [open]);

  // 打开时锁住底层页面滚动：浮窗里的滑动不该带着后面的页面一起动
  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open, onClose]);

  return (
    <>
      {!open && (
        <button
          type="button"
          data-testid="tutor-dock-bubble"
          onClick={onOpen}
          aria-label="打开学习私教"
          title="学习私教"
          className="fixed bottom-5 right-4 z-30 inline-flex h-14 items-center gap-2 rounded-full bg-teal pl-4 pr-5 font-bold text-white shadow-[0_10px_26px_rgba(15,118,110,0.38)] transition active:scale-95 lg:bottom-6 lg:right-6"
        >
          <Sparkles size={20} />
          <span className="text-sm">AI 私教</span>
        </button>
      )}

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center lg:justify-end lg:p-6"
          role="dialog"
          aria-modal="true"
          aria-label="学习私教"
        >
          <button
            type="button"
            aria-label="收起私教"
            tabIndex={-1}
            onClick={onClose}
            className="absolute inset-0 cursor-default bg-ink/45 lg:bg-ink/35"
          />
          <div
            data-testid="tutor-dock-window"
            className="relative flex h-[92vh] w-full flex-col overflow-hidden rounded-t-3xl border border-line bg-panel shadow-2xl lg:h-[min(48rem,88vh)] lg:w-[30rem] lg:rounded-2xl"
          >
            {/* 手机上这是从底部拉起来的面板，给个视觉提示 */}
            <div className="mx-auto mt-2 h-1 w-10 shrink-0 rounded-full bg-line lg:hidden" />
            {mounted && (
              <TutorChat
                token={token}
                apiBase={apiBase}
                children={children}
                request={request}
                onClose={onClose}
              />
            )}
          </div>
        </div>
      )}
    </>
  );
}
