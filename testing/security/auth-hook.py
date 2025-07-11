#!/usr/bin/env python3
"""
OWASP ZAP Authentication Hook for ReskFlow API
Handles JWT-based authentication for security testing
"""

import json
import requests
from zapv2 import ZAPv2

def authenticate(zap, target_url, context_id):
    """
    Authenticate users and set up session handling for ZAP
    """
    # User credentials for different roles
    users = [
        {
            "name": "test-customer",
            "username": "customer@test.com", 
            "password": "Test123!@#",
            "role": "CUSTOMER"
        },
        {
            "name": "test-merchant",
            "username": "merchant@test.com",
            "password": "Test123!@#", 
            "role": "MERCHANT"
        },
        {
            "name": "test-driver",
            "username": "driver@test.com",
            "password": "Test123!@#",
            "role": "DRIVER"
        },
        {
            "name": "test-admin",
            "username": "admin@test.com",
            "password": "Test123!@#",
            "role": "ADMIN"
        }
    ]
    
    # Login endpoint
    login_url = f"{target_url}/api/auth/login"
    
    for user in users:
        try:
            # Perform login
            response = requests.post(login_url, json={
                "email": user["username"],
                "password": user["password"]
            })
            
            if response.status_code == 200:
                data = response.json()
                access_token = data["tokens"]["accessToken"]
                
                # Create ZAP user
                user_id = zap.users.new_user(context_id, user["name"])
                
                # Set authentication credentials
                auth_credentials = f"Bearer {access_token}"
                zap.users.set_authentication_credentials(
                    context_id,
                    user_id,
                    auth_credentials
                )
                
                # Enable the user
                zap.users.set_user_enabled(context_id, user_id, True)
                
                print(f"✓ Authenticated user: {user['name']} (role: {user['role']})")
                
                # Set up session management
                zap.httpsessions.create_empty_session(
                    target_url,
                    f"session-{user['name']}"
                )
                
                # Add authorization header
                zap.replacer.add_rule(
                    f"auth-{user['name']}",
                    True,
                    "REQ_HEADER",
                    False,
                    "Authorization",
                    f"Bearer {access_token}",
                    ""
                )
                
            else:
                print(f"✗ Failed to authenticate {user['name']}: {response.status_code}")
                
        except Exception as e:
            print(f"✗ Error authenticating {user['name']}: {str(e)}")

def zap_hooks(zap, target_url):
    """
    Main hook function called by ZAP
    """
    print("Setting up ReskFlow authentication...")
    
    # Get or create context
    context_name = "ReskFlow API"
    context_id = None
    
    # Check if context exists
    contexts = zap.context.context_list
    for ctx in contexts:
        if zap.context.context(ctx)["name"] == context_name:
            context_id = ctx
            break
    
    if not context_id:
        # Create new context
        context_id = zap.context.new_context(context_name)
        zap.context.include_in_context(context_id, f"{target_url}/api/.*")
        
    # Set up authentication
    authenticate(zap, target_url, context_id)
    
    print("✓ Authentication setup complete")

if __name__ == "__main__":
    # This allows the script to be tested standalone
    zap = ZAPv2()
    target = "http://localhost:3000"
    zap_hooks(zap, target)