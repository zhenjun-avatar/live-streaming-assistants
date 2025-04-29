#!/bin/bash

# 配置
BASE_DIR="/opt/elizaos/eliza"  # 应用根目录
DATA_DIR="${BASE_DIR}/user_data"  # 用户数据目录
CONFIG_DIR="${BASE_DIR}/config"   # 用户配置目录
LOG_DIR="${BASE_DIR}/logs"        # 日志目录
NGINX_DIR="/etc/nginx"            # Nginx 配置目录
REQUIRED_NODE_VERSION="23.3.0"    # 需要的 Node.js 版本
REQUIRED_PNPM_VERSION="9.15.7"    # 需要的 pnpm 版本
PORT_START=3000                   # 起始端口
PORT_END=3999                     # 结束端口
INACTIVE_TIMEOUT=3600            # 不活跃超时时间（秒）

# 设置目录权限
setup_directories() {
    echo "设置目录权限..."
    
    # 创建必要的目录
    mkdir -p "$DATA_DIR" "$CONFIG_DIR" "$LOG_DIR"
    
    # 设置目录所有权
    chown -R $USER:$USER "$DATA_DIR"
    chown -R $USER:$USER "$CONFIG_DIR"
    chown -R $USER:$USER "$LOG_DIR"
    
    # 设置目录权限
    chmod 755 "$DATA_DIR" "$CONFIG_DIR" "$LOG_DIR"
    
    echo "目录权限设置完成"
}

# 设置用户实例目录权限
setup_user_directories() {
    local user_id=$1
    if [ -z "$user_id" ]; then
        echo "Error: 需要用户ID"
        return 1
    fi

    echo "设置用户 ${user_id} 的目录权限..."
    
    # 创建用户特定目录
    mkdir -p "${DATA_DIR}/user_${user_id}"
    
    # 设置所有权
    chown -R $USER:$USER "${DATA_DIR}/user_${user_id}"
    chown $USER:$USER "${CONFIG_DIR}/user_${user_id}.env" 2>/dev/null || true
    chown $USER:$USER "${LOG_DIR}/user_${user_id}.log" 2>/dev/null || true
    
    # 设置权限
    chmod 755 "${DATA_DIR}/user_${user_id}"
    chmod 644 "${CONFIG_DIR}/user_${user_id}.env" 2>/dev/null || true
    chmod 644 "${LOG_DIR}/user_${user_id}.log" 2>/dev/null || true
    
    echo "用户目录权限设置完成"
}

# 检查 Node.js 版本
check_node() {
    if ! command -v node &> /dev/null; then
        echo "Error: Node.js 未安装"
        return 1
    fi

    local current_version=$(node --version | sed 's/^v//')
    if [ "$current_version" != "$REQUIRED_NODE_VERSION" ]; then
        echo "Error: 需要 Node.js ${REQUIRED_NODE_VERSION}，当前版本是 ${current_version}"
        return 1
    fi

    echo "Node.js 版本检查通过"
    return 0
}

# 检查 pnpm 版本
check_pnpm() {
    if ! command -v pnpm &> /dev/null; then
        echo "Error: pnpm 未安装"
        return 1
    fi

    local current_version=$(pnpm --version)
    if [ "$current_version" != "$REQUIRED_PNPM_VERSION" ]; then
        echo "Error: 需要 pnpm ${REQUIRED_PNPM_VERSION}，当前版本是 ${current_version}"
        return 1
    fi

    echo "pnpm 版本检查通过"
    return 0
}

# 获取用户最后活跃时间
get_last_active() {
    local user_id=$1
    local pid_file="${DATA_DIR}/user_${user_id}/pid"
    
    if [ -f "$pid_file" ]; then
        local pid=$(cat "$pid_file")
        if ps -p "$pid" > /dev/null; then
            local last_active=$(stat -c %Y "${LOG_DIR}/user_${user_id}.log" 2>/dev/null || echo 0)
            echo "$last_active"
            return 0
        fi
    fi
    echo "0"
}

# 清理不活跃实例
cleanup_inactive() {
    echo "清理不活跃实例..."
    local current_time=$(date +%s)
    
    for pid_file in "${DATA_DIR}"/user_*/pid; do
        if [ -f "$pid_file" ]; then
            local user_id=$(basename $(dirname "$pid_file") | sed 's/user_//')
            local last_active=$(get_last_active "$user_id")
            local inactive_time=$((current_time - last_active))
            
            if [ $inactive_time -gt $INACTIVE_TIMEOUT ]; then
                echo "停止不活跃用户 $user_id (${inactive_time}s 未活动)"
                stop_user "$user_id"
            fi
        fi
    done
}

# 获取可用端口
get_available_port() {
    local user_id=$1
    local hash_port=$((($user_id % (PORT_END - PORT_START + 1)) + PORT_START))
    local port=$hash_port
    
    # 检查端口是否被占用
    while netstat -tuln | grep -q ":$port "; do
        port=$((port + 1))
        if [ $port -gt $PORT_END ]; then
            port=$PORT_START
        fi
        if [ $port -eq $hash_port ]; then
            echo "Error: 没有可用端口"
            return 1
        fi
    done
    
    echo $port
    return 0
}

# 创建 Nginx 配置
# 修改 create_nginx_config 函数
create_nginx_config() {
    local user_id=$1
    local port=$2
    
    # 创建临时配置文件
    local temp_conf="/tmp/user_${user_id}.conf.tmp"
    
    # 写入配置到临时文件
    cat > "$temp_conf" <<EOL
location /user/${user_id}/ {
    proxy_pass http://127.0.0.1:${port}/;
    proxy_http_version 1.1;
    proxy_set_header Upgrade \$http_upgrade;
    proxy_set_header Connection 'upgrade';
    proxy_set_header Host \$host;
    proxy_cache_bypass \$http_upgrade;
    proxy_set_header X-Real-IP \$remote_addr;
    proxy_set_header X-User-ID "${user_id}";
}
EOL

    # 使用 sudo 移动文件到正确位置
    sudo mv "$temp_conf" "${NGINX_DIR}/conf.d/user_${user_id}.conf"
    
    # 设置正确的权限
    sudo chmod 644 "${NGINX_DIR}/conf.d/user_${user_id}.conf"
    
    # 检查 Nginx 配置
    if sudo nginx -t; then
        # 重新加载 Nginx 配置
        sudo systemctl reload nginx || sudo nginx -s reload
    else
        echo "Error: Nginx 配置测试失败"
        return 1
    fi
}
# 创建用户实例
create_user() {
    local user_id=$1
    if [ -z "$user_id" ]; then
        echo "Error: 需要用户ID"
        return 1
    fi

    # 检查依赖
    check_node || return 1
    check_pnpm || return 1

    # 获取可用端口
    local port=$(get_available_port "$user_id")
    if [ $? -ne 0 ]; then
        echo "Error: 无法分配端口"
        return 1
    fi

    # 设置目录权限
    setup_user_directories "$user_id"
    
    # 创建用户配置文件
    cat > "${CONFIG_DIR}/user_${user_id}.env" <<EOL
USER_ID=${user_id}
SERVER_PORT=${port}
SQLITE_FILE=${DATA_DIR}/user_${user_id}/db.sqlite
OPENAI_API_KEY=
TWITTER_USERNAME=
TWITTER_PASSWORD=
TWITTER_EMAIL=
WALLET_SECRET_SALT=secret_salt_${user_id}
BASE_PATH=/user/${user_id}
EOL

    # 设置配置文件权限
    chmod 644 "${CONFIG_DIR}/user_${user_id}.env"

    # 创建 Nginx 配置
    create_nginx_config "$user_id" "$port"

    echo "创建用户 ${user_id} 的配置文件：${CONFIG_DIR}/user_${user_id}.env"
    echo "分配端口: $port"
    echo "访问路径: /user/${user_id}/"
    echo "请编辑配置文件填写必要的API密钥"
    
    # 启动用户实例
    start_user "$user_id"
}

# 启动用户实例
start_user() {
    local user_id=$1
    if [ -z "$user_id" ]; then
        echo "Error: 需要用户ID"
        return 1
    fi

    # 检查依赖
    check_node || return 1
    check_pnpm || return 1

    # 检查是否已运行
    if pgrep -f "node.*USER_ID=${user_id}" > /dev/null; then
        echo "用户 ${user_id} 的实例已在运行"
        return 0
    fi

    # 确保日志文件存在并设置正确的权限
    touch "${LOG_DIR}/user_${user_id}.log"
    chmod 644 "${LOG_DIR}/user_${user_id}.log"

    # 加载环境变量
    if [ ! -f "${CONFIG_DIR}/user_${user_id}.env" ]; then
        echo "Error: 用户配置文件不存在"
        return 1
    fi
    source "${CONFIG_DIR}/user_${user_id}.env"

    # 启动应用
    cd "$BASE_DIR" && \
    SERVER_PORT=$SERVER_PORT \
    USER_ID=$USER_ID \
    SQLITE_FILE=$SQLITE_FILE \
    BASE_PATH=/user/${user_id} \
    nohup pnpm start > "${LOG_DIR}/user_${user_id}.log" 2>&1 &

    # 保存进程ID
    echo $! > "${DATA_DIR}/user_${user_id}/pid"

    echo "用户 ${user_id} 的应用已启动"
    echo "访问路径: /user/${user_id}/"
    echo "内部端口: $SERVER_PORT"
    echo "数据库文件: $SQLITE_FILE"
    echo "日志文件: ${LOG_DIR}/user_${user_id}.log"
}

# 停止用户实例
stop_user() {
    local user_id=$1
    if [ -z "$user_id" ]; then
        echo "Error: 需要用户ID"
        return 1
    fi

    # 停止进程
    if [ -f "${DATA_DIR}/user_${user_id}/pid" ]; then
        local pid=$(cat "${DATA_DIR}/user_${user_id}/pid")
        kill $pid 2>/dev/null || true
        rm "${DATA_DIR}/user_${user_id}/pid"
    fi

    # 删除 Nginx 配置
    rm -f "${NGINX_DIR}/conf.d/user_${user_id}.conf"
    sudo nginx -s reload

    echo "用户 ${user_id} 的实例已停止"
}

# 移除用户实例
remove_user() {
    local user_id=$1
    if [ -z "$user_id" ]; then
        echo "Error: 需要用户ID"
        return 1
    fi

    # 停止实例
    stop_user "$user_id"

    # 移除数据和配置
    rm -rf "${DATA_DIR}/user_${user_id}"
    rm -f "${CONFIG_DIR}/user_${user_id}.env"
    rm -f "${LOG_DIR}/user_${user_id}.log"

    echo "用户 ${user_id} 的所有数据已移除"
}

# 查看用户日志
logs_user() {
    local user_id=$1
    if [ -z "$user_id" ]; then
        echo "Error: 需要用户ID"
        return 1
    fi

    tail -f "${LOG_DIR}/user_${user_id}.log"
}

# 列出所有用户实例
list_users() {
    echo "当前运行的用户实例："
    ps aux | grep "node.*USER_ID=" | grep -v grep
    
    echo -e "\n用户数据目录："
    ls -l "$DATA_DIR" | grep "user_"
    
    echo -e "\n用户配置文件："
    ls -l "$CONFIG_DIR" | grep "user_.*\.env"
    
    echo -e "\n端口使用情况："
    echo "已分配的端口："
    for env_file in "${CONFIG_DIR}"/user_*.env; do
        if [ -f "$env_file" ]; then
            user_id=$(basename "$env_file" .env | sed 's/user_//')
            port=$(grep "^PORT=" "$env_file" | cut -d'=' -f2)
            echo "用户 $user_id: 端口 $port"
        fi
    done
    
    echo -e "\n当前监听的端口："
    netstat -tuln | grep "LISTEN" | grep ":3"
}

# 重启用户实例
restart_user() {
    local user_id=$1
    if [ -z "$user_id" ]; then
        echo "Error: 需要用户ID"
        return 1
    fi

    stop_user "$user_id"
    sleep 2
    start_user "$user_id"
}

# 显示用户状态
status_user() {
    local user_id=$1
    if [ -z "$user_id" ]; then
        echo "Error: 需要用户ID"
        return 1
    fi

    echo "用户 ${user_id} 状态："
    echo "1. 进程状态："
    ps aux | grep "node.*USER_ID=${user_id}" | grep -v grep || echo "未运行"
    
    echo -e "\n2. 数据目录："
    ls -l "${DATA_DIR}/user_${user_id}" 2>/dev/null || echo "数据目录不存在"
    
    echo -e "\n3. 配置文件："
    cat "${CONFIG_DIR}/user_${user_id}.env" 2>/dev/null || echo "配置文件不存在"
    
    echo -e "\n4. 最新日志："
    tail -n 5 "${LOG_DIR}/user_${user_id}.log" 2>/dev/null || echo "日志文件不存在"
    
    echo -e "\n5. 端口使用情况："
    if [ -f "${CONFIG_DIR}/user_${user_id}.env" ]; then
        port=$(grep "^PORT=" "${CONFIG_DIR}/user_${user_id}.env" | cut -d'=' -f2)
        netstat -tuln | grep ":$port " || echo "端口 $port 未使用"
    fi
}

# 初始化环境
init() {
    # 设置目录权限
    setup_directories
    
    # 检查依赖
    check_node || return 1
    check_pnpm || return 1
    
    echo "环境初始化完成"
}

# 主命令处理
case "$1" in
    "init")
        init
        ;;
    "cleanup")
        cleanup_inactive
        ;;
    "create")
        create_user "$2"
        ;;
    "remove")
        remove_user "$2"
        ;;
    "start")
        start_user "$2"
        ;;
    "stop")
        stop_user "$2"
        ;;
    "restart")
        restart_user "$2"
        ;;
    "logs")
        logs_user "$2"
        ;;
    "list")
        list_users
        ;;
    "status")
        status_user "$2"
        ;;
    *)
        echo "Usage: $0 {init|create|remove|start|stop|restart|logs|list|status|cleanup} [user_id]"
        echo
        echo "Commands:"
        echo "  init             - 初始化环境和目录权限"
        echo "  create <user_id> - 创建新用户实例"
        echo "  remove <user_id> - 移除用户实例"
        echo "  start <user_id>  - 启动用户实例"
        echo "  stop <user_id>   - 停止用户实例"
        echo "  restart <user_id>- 重启用户实例"
        echo "  logs <user_id>   - 查看用户日志"
        echo "  list            - 列出所有用户实例"
        echo "  status <user_id> - 显示用户状态"
        echo "  cleanup         - 清理不活跃实例"
        exit 1
        ;;
esac
