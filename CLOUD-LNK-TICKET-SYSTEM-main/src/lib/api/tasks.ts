import { apiClient, ApiResponse } from './client';

export interface UpdateTaskPayload {
  statusId?: string;
  assigneeId?: string | null;
  priority?: string;
  title?: string;
  description?: string | null;
  customFields?: Record<string, any> | string;
  listId?: string;
}

export interface CreateTaskPayload {
  title: string;
  spaceId: string;
  listId: string;
  description?: string;
  priority?: string;
  statusId?: string;
  assigneeId?: string;
  customFields?: Record<string, any> | string;
}

export const tasksApi = {
  fetchTasks: async (params?: Record<string, string>): Promise<ApiResponse<{ tasks: any[] }>> => {
    const searchParams = new URLSearchParams(params || {});
    const query = searchParams.toString() ? `?${searchParams.toString()}` : '';
    return apiClient.get(`/api/tasks${query}`);
  },

  fetchTask: async (id: string): Promise<ApiResponse<{ task: any }>> => {
    return apiClient.get(`/api/tasks/${id}`);
  },

  createTask: async (payload: CreateTaskPayload): Promise<ApiResponse<{ success: boolean; task: any }>> => {
    return apiClient.post('/api/tasks', payload);
  },

  updateTask: async (id: string, payload: UpdateTaskPayload): Promise<ApiResponse<{ success: boolean; task: any }>> => {
    return apiClient.patch(`/api/tasks/${id}`, payload);
  },

  deleteTask: async (id: string): Promise<ApiResponse<{ success: boolean }>> => {
    return apiClient.delete(`/api/tasks/${id}`);
  },

  updateStatus: async (taskId: string, statusId: string): Promise<ApiResponse<{ success: boolean; task: any }>> => {
    return apiClient.patch(`/api/tasks/${taskId}`, { statusId });
  },

  updatePriority: async (taskId: string, priority: string): Promise<ApiResponse<{ success: boolean; task: any }>> => {
    return apiClient.patch(`/api/tasks/${taskId}`, { priority });
  },

  assignToUser: async (taskId: string, assigneeId: string | null): Promise<ApiResponse<{ success: boolean; task: any }>> => {
    return apiClient.patch(`/api/tasks/${taskId}`, { assigneeId });
  },
};

export * from './client';
