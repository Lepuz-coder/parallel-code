export enum IPC {
  // Agent/PTY
  SpawnAgent = 'spawn_agent',
  WriteToAgent = 'write_to_agent',
  ResizeAgent = 'resize_agent',
  PauseAgent = 'pause_agent',
  ResumeAgent = 'resume_agent',
  KillAgent = 'kill_agent',
  CountRunningAgents = 'count_running_agents',
  KillAllAgents = 'kill_all_agents',
  ListAgents = 'list_agents',

  // Task
  CreateTask = 'create_task',
  DeleteTask = 'delete_task',

  // Persistence
  SaveAppState = 'save_app_state',
  LoadAppState = 'load_app_state',

  // Window
  WindowIsFocused = '__window_is_focused',
  WindowIsMaximized = '__window_is_maximized',
  WindowMinimize = '__window_minimize',
  WindowToggleMaximize = '__window_toggle_maximize',
  WindowClose = '__window_close',
  WindowForceClose = '__window_force_close',
  WindowHide = '__window_hide',
  WindowMaximize = '__window_maximize',
  WindowUnmaximize = '__window_unmaximize',
  WindowSetSize = '__window_set_size',
  WindowSetPosition = '__window_set_position',
  WindowGetPosition = '__window_get_position',
  WindowGetSize = '__window_get_size',
  WindowFocus = '__window_focus',
  WindowBlur = '__window_blur',
  WindowResized = '__window_resized',
  WindowMoved = '__window_moved',
  WindowCloseRequested = '__window_close_requested',

  // Dialog
  DialogConfirm = '__dialog_confirm',
  DialogOpen = '__dialog_open',

  // Shell
  ShellReveal = '__shell_reveal',
  ShellOpenFile = '__shell_open_file',
  ShellOpenInEditor = '__shell_open_in_editor',

  // Filesystem
  CheckPathExists = 'check_path_exists',

  // Remote access
  StartRemoteServer = 'start_remote_server',
  StopRemoteServer = 'stop_remote_server',
  GetRemoteStatus = 'get_remote_status',

  // Plan
  PlanContent = 'plan_content',
  ReadPlanContent = 'read_plan_content',
  StopPlanWatcher = 'stop_plan_watcher',

  // Ask about code
  AskAboutCode = 'ask_about_code',
  CancelAskAboutCode = 'cancel_ask_about_code',

  // Docker
  CheckDockerAvailable = 'check_docker_available',
  CheckDockerImageExists = 'check_docker_image_exists',
  BuildDockerImage = 'build_docker_image',

  // System
  GetSystemFonts = 'get_system_fonts',

  // Notifications
  ShowNotification = 'show_notification',
  NotificationClicked = 'notification_clicked',

  // Filesystem
  ReadDirectory = 'read_directory',
  ReadFileContent = 'read_file_content',
}
