const fs = require('fs-extra');
const path = require('path');

async function setupEmail() {
    console.log('\n🔧 Email Notification Setup');
    console.log('==========================\n');

    console.log('📧 This will configure email notifications for your backup reports.');
    console.log('💡 For Gmail, you\'ll need to use an "App Password" instead of your regular password.');
    console.log('🔗 Learn how to create an App Password: https://support.google.com/accounts/answer/185833\n');

    // Use readline for simpler input
    const readline = require('readline');
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });

    const question = (prompt) => {
        return new Promise((resolve) => {
            rl.question(prompt, resolve);
        });
    };

    try {
        const enableEmail = await question('Do you want to enable email notifications? (y/n): ');
        
        if (enableEmail.toLowerCase() !== 'y' && enableEmail.toLowerCase() !== 'yes') {
            // Load current config
            const configPath = path.join(process.cwd(), 'config', 'config.json');
            let config = {};
            
            if (await fs.pathExists(configPath)) {
                config = await fs.readJson(configPath);
            }

            config.email = { enabled: false };
            await fs.writeJson(configPath, config, { spaces: 2 });
            
            console.log('\n📧 Email notifications disabled.');
            rl.close();
            return;
        }

        const fromEmail = await question('Enter your Gmail address (sender): ');
        if (!fromEmail.includes('@gmail.com')) {
            console.log('❌ Please enter a valid Gmail address');
            rl.close();
            return;
        }

        const appPassword = await question('Enter your Gmail App Password: ');
        if (appPassword.length < 8) {
            console.log('❌ App password should be at least 8 characters');
            rl.close();
            return;
        }

        const toEmail = await question('Enter recipient email (default: vinodkhoraa@gmail.com): ') || 'vinodkhoraa@gmail.com';
        const sendOnSuccess = await question('Send email on successful backups? (y/n): ');
        const sendOnFailure = await question('Send email on backup failures? (y/n): ');

        // Load current config
        const configPath = path.join(process.cwd(), 'config', 'config.json');
        let config = {};
        
        if (await fs.pathExists(configPath)) {
            config = await fs.readJson(configPath);
        }

        // Update email configuration
        config.email = {
            enabled: true,
            smtp: {
                host: 'smtp.gmail.com',
                port: 587,
                secure: false,
                auth: {
                    user: fromEmail,
                    pass: appPassword
                }
            },
            from: fromEmail,
            to: toEmail,
            subject: 'Tally Backup Report',
            sendOnSuccess: sendOnSuccess.toLowerCase() === 'y' || sendOnSuccess.toLowerCase() === 'yes',
            sendOnFailure: sendOnFailure.toLowerCase() === 'y' || sendOnFailure.toLowerCase() === 'yes',
            includeStats: true,
            includeDriveLink: true
        };

        // Save updated config
        await fs.writeJson(configPath, config, { spaces: 2 });

        console.log('\n✅ Email configuration saved successfully!');
        console.log(`📧 Notifications will be sent to: ${toEmail}`);
        console.log(`📤 From: ${fromEmail}`);
        console.log(`✅ Success notifications: ${config.email.sendOnSuccess ? 'Enabled' : 'Disabled'}`);
        console.log(`❌ Failure notifications: ${config.email.sendOnFailure ? 'Enabled' : 'Disabled'}`);

        console.log('\n💡 Next steps:');
        console.log('1. Run a test backup to verify email notifications work');
        console.log('2. Check your spam folder if you don\'t receive the email');
        console.log('3. Consider adding the sender email to your contacts\n');

    } catch (error) {
        console.error('❌ Setup failed:', error.message);
    } finally {
        rl.close();
    }
}

// Run setup if called directly
if (require.main === module) {
    setupEmail().catch(console.error);
}

module.exports = setupEmail;
