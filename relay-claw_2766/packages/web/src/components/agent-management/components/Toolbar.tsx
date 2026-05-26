import { SearchInput } from '@/components/shared/SearchInput';
import { RefreshButton } from '@/components/shared/RefreshButton';
import { Select } from '@/components/shared/Select';
import type { AgentSourceFilter } from '../utils';

export interface ToolbarProps {
  searchQuery: string;
  sourceFilter: AgentSourceFilter;
  onSearchChange: (query: string) => void;
  onClearSearch: () => void;
  onSourceFilterChange: (filter: AgentSourceFilter) => void;
  onRefresh: () => void;
  loading?: boolean;
}

const SOURCE_FILTER_OPTIONS: Array<{ value: AgentSourceFilter; label: string }> = [
  { value: 'all', label: '全部' },
  { value: 'seed', label: '预置智能体' },
  { value: 'runtime', label: '自定义' },
  { value: 'experts-plaza', label: '智能体广场' },
];

export function Toolbar({
  searchQuery,
  sourceFilter,
  onSearchChange,
  onClearSearch,
  onSourceFilterChange,
  onRefresh,
  loading,
}: ToolbarProps) {
  return (
    <div className="flex w-full items-center gap-3">
      <Select
        value={sourceFilter}
        options={SOURCE_FILTER_OPTIONS}
        onChange={(value) => onSourceFilterChange(value)}
        className="w-[200px]"
        aria-label="筛选来源"
      />
      <SearchInput
        value={searchQuery}
        onChange={onSearchChange}
        onClear={onClearSearch}
        placeholder="搜索智能体"
        aria-label="搜索智能体"
        clearAriaLabel="清除搜索"
        wrapperClassName="flex-1"
      />
      <RefreshButton
        onClick={onRefresh}
        disabled={loading}
        aria-label="刷新列表"
      />
    </div>
  );
}
