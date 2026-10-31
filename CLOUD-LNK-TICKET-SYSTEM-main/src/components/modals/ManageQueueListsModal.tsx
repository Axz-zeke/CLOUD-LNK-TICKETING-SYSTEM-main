'use client';

import React from 'react';
import { SpaceItem } from '@/context/workspace-context';
import { DepartmentManagementModal } from './DepartmentManagementModal';
import { AuthenticatedUser } from '@/lib/security/rbac';

export interface ManageQueueListsModalProps {
  isOpen: boolean;
  onClose: () => void;
  space?: SpaceItem;
  currentUser?: AuthenticatedUser;
  onListsChanged?: () => void;
}

export function ManageQueueListsModal({
  isOpen,
  onClose,
  space,
  currentUser,
  onListsChanged,
}: ManageQueueListsModalProps) {
  return (
    <DepartmentManagementModal
      isOpen={isOpen}
      onClose={onClose}
      currentUser={currentUser}
      initialSpaceId={space?.id}
      onQueuesChanged={onListsChanged}
    />
  );
}

export { DepartmentManagementModal };
