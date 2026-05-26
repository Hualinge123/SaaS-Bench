import type { AgentData } from '@/hooks/useAgentData';
import { OverflowTooltip } from '@/components/shared/OverflowTooltip';
import { HelpPrompt } from '@/components/shared/HelpPrompt';

export interface DetailContentProps {
  agent: AgentData;
}

export function DetailContent({ agent }: DetailContentProps) {
  const modelText = agent.defaultModel || '未配置模型';
  const imageModelText = agent.imageModel || '未配置';
  const imageGenModelText = agent.imageGenModel || '未配置';

  return (
    <div className="flex flex-col gap-4 pb-8">
      <h2 className="text-[16px] font-semibold text-[var(--text-primary)]">基础信息</h2>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="min-w-0 flex flex-col gap-2">
          <h2 className="text-[12px] font-medium text-[var(--text-muted)]">描述</h2>
          <OverflowTooltip
            content={agent.roleDescription || '暂无描述'}
            className="block w-full min-w-0"
            placement="top"
          >
            <span className="block min-w-0 truncate text-[14px] text-[var(--text-primary)]">
              {agent.roleDescription || '暂无描述'}
            </span>
          </OverflowTooltip>
        </div>

        <div className="min-w-0 flex flex-col gap-2">
          <div className="flex items-center gap-1.5">
            <h2 className="text-[12px] font-medium text-[var(--text-muted)]">主模型</h2>
            <HelpPrompt tooltip="负责思考、推理、生成文本输出" ariaLabel="主模型说明" />
          </div>
          <p className="break-words text-[14px] text-[var(--text-primary)]">{modelText}</p>
        </div>

        <div className="min-w-0 flex flex-col gap-2">
          <div className="flex items-center gap-1.5">
            <h2 className="text-[12px] font-medium text-[var(--text-muted)]">图像理解模型（可选）</h2>
            <HelpPrompt tooltip="用于对图片内容的识别场景，对图片附件进行处理" ariaLabel="图像理解模型说明" />
          </div>
          <p className="break-words text-[14px] text-[var(--text-primary)]">{imageModelText}</p>
        </div>

        <div className="min-w-0 flex flex-col gap-2">
          <div className="flex items-center gap-1.5">
            <h2 className="text-[12px] font-medium text-[var(--text-muted)]">图像生成模型（可选）</h2>
            <HelpPrompt tooltip="用于根据文本描述生成图片" ariaLabel="图像生成模型说明" />
          </div>
          <p className="break-words text-[14px] text-[var(--text-primary)]">{imageGenModelText}</p>
        </div>
      </div>
    </div>
  );
}