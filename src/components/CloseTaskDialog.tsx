import { closeTask } from '../store/store';
import { ConfirmDialog } from './ConfirmDialog';
import type { Task } from '../store/types';

interface CloseTaskDialogProps {
  open: boolean;
  task: Task;
  onDone: () => void;
}

export function CloseTaskDialog(props: CloseTaskDialogProps) {
  return (
    <ConfirmDialog
      open={props.open}
      title="Close Task"
      message={
        <p style={{ margin: '0' }}>This will stop all running agents and shells for this task.</p>
      }
      confirmLabel="Close"
      danger={false}
      onConfirm={() => {
        props.onDone();
        closeTask(props.task.id);
      }}
      onCancel={() => props.onDone()}
    />
  );
}
