const nodemailer = require('nodemailer');
const logger = require('./utils/logger');

class EmailService {
    constructor(config) {
        this.config = config;
        this.transporter = null;
    }

    /**
     * Initialize email service
     */
    async initialize() {
        try {
            if (!this.config.enabled) {
                logger.info('Email notifications are disabled');
                return;
            }

            // Create transporter
            this.transporter = nodemailer.createTransport({
                host: this.config.smtp.host,
                port: this.config.smtp.port,
                secure: this.config.smtp.secure,
                auth: {
                    user: this.config.smtp.auth.user,
                    pass: this.config.smtp.auth.pass
                }
            });

            // Verify connection
            await this.transporter.verify();
            logger.info('Email service initialized successfully');
        } catch (error) {
            logger.error('Failed to initialize email service:', error);
            // Don't throw error - email is optional
        }
    }

    /**
     * Send backup success notification
     */
    async sendBackupSuccess(backupStats, driveLink = null) {
        try {
            if (!this.config.enabled || !this.config.sendOnSuccess || !this.transporter) {
                return;
            }

            const subject = `✅ ${this.config.subject} - Success`;
            const html = this.generateSuccessEmail(backupStats, driveLink);

            await this.sendEmail(subject, html);
            logger.info('Backup success email sent successfully');
        } catch (error) {
            logger.error('Failed to send backup success email:', error);
        }
    }

    /**
     * Send backup failure notification
     */
    async sendBackupFailure(error, backupStats = null, driveLink = null) {
        try {
            if (!this.config.enabled || !this.config.sendOnFailure || !this.transporter) {
                return;
            }

            const subject = `❌ ${this.config.subject} - Failure`;
            const html = this.generateFailureEmail(error, backupStats, driveLink);

            await this.sendEmail(subject, html);
            logger.info('Backup failure email sent successfully');
        } catch (error) {
            logger.error('Failed to send backup failure email:', error);
        }
    }

    /**
     * Send email using configured transporter
     */
    async sendEmail(subject, html) {
        const mailOptions = {
            from: this.config.from,
            to: this.config.to,
            subject: subject,
            html: html
        };

        await this.transporter.sendMail(mailOptions);
    }

    /**
     * Generate success email HTML
     */
    generateSuccessEmail(backupStats, driveLink) {
        const duration = backupStats.duration ? (backupStats.duration / 1000).toFixed(2) : 'N/A';
        const totalSize = this.formatFileSize(backupStats.totalSize || 0);
        
        let html = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <div style="background-color: #4CAF50; color: white; padding: 20px; text-align: center; border-radius: 8px 8px 0 0;">
                <h1 style="margin: 0;">✅ Backup Completed Successfully</h1>
                <p style="margin: 10px 0 0 0;">Tally Backup Pro Report</p>
            </div>
            
            <div style="background-color: #f9f9f9; padding: 20px; border-radius: 0 0 8px 8px;">
                <h2 style="color: #333; margin-top: 0;">📊 Backup Summary</h2>
                
                <table style="width: 100%; border-collapse: collapse; margin-bottom: 20px;">
                    <tr style="background-color: #fff;">
                        <td style="padding: 10px; border: 1px solid #ddd; font-weight: bold;">Files Processed</td>
                        <td style="padding: 10px; border: 1px solid #ddd;">${backupStats.filesProcessed || 0}</td>
                    </tr>
                    <tr style="background-color: #f5f5f5;">
                        <td style="padding: 10px; border: 1px solid #ddd; font-weight: bold;">Files Uploaded</td>
                        <td style="padding: 10px; border: 1px solid #ddd;">${backupStats.filesUploaded || 0}</td>
                    </tr>
                    <tr style="background-color: #fff;">
                        <td style="padding: 10px; border: 1px solid #ddd; font-weight: bold;">Total Size</td>
                        <td style="padding: 10px; border: 1px solid #ddd;">${totalSize}</td>
                    </tr>
                    <tr style="background-color: #f5f5f5;">
                        <td style="padding: 10px; border: 1px solid #ddd; font-weight: bold;">Duration</td>
                        <td style="padding: 10px; border: 1px solid #ddd;">${duration} seconds</td>
                    </tr>
                    <tr style="background-color: #fff;">
                        <td style="padding: 10px; border: 1px solid #ddd; font-weight: bold;">Status</td>
                        <td style="padding: 10px; border: 1px solid #ddd; color: #4CAF50; font-weight: bold;">✅ Success</td>
                    </tr>
                </table>
        `;

        if (this.config.includeDriveLink && driveLink) {
            html += `
                <div style="background-color: #2196F3; color: white; padding: 15px; border-radius: 5px; text-align: center; margin-bottom: 20px;">
                    <h3 style="margin: 0 0 10px 0;">🔗 Access Your Backup</h3>
                    <a href="${driveLink}" style="color: white; text-decoration: none; font-weight: bold; background-color: rgba(255,255,255,0.2); padding: 10px 20px; border-radius: 5px; display: inline-block;">
                        Open Google Drive Backup
                    </a>
                </div>
            `;
        }

        html += `
                <div style="background-color: #E8F5E8; padding: 15px; border-radius: 5px; border-left: 4px solid #4CAF50;">
                    <h3 style="margin: 0 0 10px 0; color: #2E7D32;">💡 What was backed up?</h3>
                    <p style="margin: 0; color: #333;">
                        ${backupStats.filesUploaded > 0 ? 
                            `${backupStats.filesUploaded} files were uploaded to your Google Drive backup folder. ` : 
                            'Your backup is up to date - no changes were detected. '
                        }
                        All files are safely stored in your "Tally Backup" folder with the original folder structure preserved.
                    </p>
                </div>
                
                <div style="margin-top: 20px; padding-top: 20px; border-top: 1px solid #ddd; color: #666; font-size: 14px;">
                    <p><strong>Backup Time:</strong> ${new Date().toLocaleString()}</p>
                    <p><strong>System:</strong> Tally Backup Pro</p>
                </div>
            </div>
        </div>
        `;

        return html;
    }

    /**
     * Generate failure email HTML
     */
    generateFailureEmail(error, backupStats, driveLink) {
        const duration = backupStats?.duration ? (backupStats.duration / 1000).toFixed(2) : 'N/A';
        const totalSize = this.formatFileSize(backupStats?.totalSize || 0);
        
        let html = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <div style="background-color: #f44336; color: white; padding: 20px; text-align: center; border-radius: 8px 8px 0 0;">
                <h1 style="margin: 0;">❌ Backup Failed</h1>
                <p style="margin: 10px 0 0 0;">Tally Backup Pro Report</p>
            </div>
            
            <div style="background-color: #f9f9f9; padding: 20px; border-radius: 0 0 8px 8px;">
                <div style="background-color: #FFEBEE; padding: 15px; border-radius: 5px; border-left: 4px solid #f44336; margin-bottom: 20px;">
                    <h3 style="margin: 0 0 10px 0; color: #C62828;">🚨 Error Details</h3>
                    <p style="margin: 0; color: #333; font-family: monospace; background-color: #fff; padding: 10px; border-radius: 3px;">
                        ${error.message || error}
                    </p>
                </div>
        `;

        if (backupStats) {
            html += `
                <h2 style="color: #333; margin-top: 0;">📊 Backup Attempt Summary</h2>
                
                <table style="width: 100%; border-collapse: collapse; margin-bottom: 20px;">
                    <tr style="background-color: #fff;">
                        <td style="padding: 10px; border: 1px solid #ddd; font-weight: bold;">Files Processed</td>
                        <td style="padding: 10px; border: 1px solid #ddd;">${backupStats.filesProcessed || 0}</td>
                    </tr>
                    <tr style="background-color: #f5f5f5;">
                        <td style="padding: 10px; border: 1px solid #ddd; font-weight: bold;">Files Uploaded</td>
                        <td style="padding: 10px; border: 1px solid #ddd;">${backupStats.filesUploaded || 0}</td>
                    </tr>
                    <tr style="background-color: #fff;">
                        <td style="padding: 10px; border: 1px solid #ddd; font-weight: bold;">Total Size</td>
                        <td style="padding: 10px; border: 1px solid #ddd;">${totalSize}</td>
                    </tr>
                    <tr style="background-color: #f5f5f5;">
                        <td style="padding: 10px; border: 1px solid #ddd; font-weight: bold;">Duration</td>
                        <td style="padding: 10px; border: 1px solid #ddd;">${duration} seconds</td>
                    </tr>
                    <tr style="background-color: #fff;">
                        <td style="padding: 10px; border: 1px solid #ddd; font-weight: bold;">Status</td>
                        <td style="padding: 10px; border: 1px solid #ddd; color: #f44336; font-weight: bold;">❌ Failed</td>
                    </tr>
                </table>
            `;
        }

        html += `
                <div style="background-color: #FFF3E0; padding: 15px; border-radius: 5px; border-left: 4px solid #FF9800;">
                    <h3 style="margin: 0 0 10px 0; color: #E65100;">🔧 What should you do?</h3>
                    <ul style="margin: 0; padding-left: 20px; color: #333;">
                        <li>Check your internet connection</li>
                        <li>Verify Google Drive storage space</li>
                        <li>Check the application logs for detailed error information</li>
                        <li>Try running a manual backup to test the system</li>
                    </ul>
                </div>
        `;

        if (this.config.includeDriveLink && driveLink) {
            html += `
                <div style="background-color: #2196F3; color: white; padding: 15px; border-radius: 5px; text-align: center; margin-top: 20px;">
                    <h3 style="margin: 0 0 10px 0;">🔗 Check Your Backup</h3>
                    <a href="${driveLink}" style="color: white; text-decoration: none; font-weight: bold; background-color: rgba(255,255,255,0.2); padding: 10px 20px; border-radius: 5px; display: inline-block;">
                        Open Google Drive Backup
                    </a>
                </div>
            `;
        }

        html += `
                <div style="margin-top: 20px; padding-top: 20px; border-top: 1px solid #ddd; color: #666; font-size: 14px;">
                    <p><strong>Failure Time:</strong> ${new Date().toLocaleString()}</p>
                    <p><strong>System:</strong> Tally Backup Pro</p>
                </div>
            </div>
        </div>
        `;

        return html;
    }

    /**
     * Format file size for display
     */
    formatFileSize(bytes) {
        const units = ['B', 'KB', 'MB', 'GB', 'TB'];
        let size = bytes;
        let unitIndex = 0;
        
        while (size >= 1024 && unitIndex < units.length - 1) {
            size /= 1024;
            unitIndex++;
        }
        
        return `${size.toFixed(2)} ${units[unitIndex]}`;
    }
}

module.exports = EmailService;
