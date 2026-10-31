/**
 * Central configuration file for global branding and application constants.
 * AIO Work Management System — L&K Industries Philippine, Inc.
 */

export const SITE_CONFIG = {
  name: 'AIO Work Management System | L&K Industries',
  shortName: 'AIO Work Management',
  company: 'L&K Industries Philippine, Inc.',
  shortCompany: 'L&K Industries Phil, Inc.',
  headerTitle: 'AIO Work Management System',
  tagline: 'L&K Industries Philippine, Inc. All-in-One Work Management System V2.0',
  description:
    'L&K Industries Philippine, Inc. All-in-One Work Management System — Unified Inter-Departmental Operations, Service Desk & Project Workspace.',
} as const;

export type SiteConfig = typeof SITE_CONFIG;
