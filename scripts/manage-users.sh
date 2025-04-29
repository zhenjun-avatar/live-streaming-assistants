#!/bin/bash

# 配置
BASE_DIR="/c/Users/liuzh/Documents/241201/Backend/eliza-0310/eliza"  # 应用根目录
DATA_DIR="${BASE_DIR}/user_data"  # 用户数据目录
CONFIG_DIR="${BASE_DIR}/config"   # 用户配置目录
LOG_DIR="${BASE_DIR}/logs"        # 日志目录

# 检查 pnpm 是否安装
check_pnpm() {
    # 尝试不同的可能路径
    if command -v pnpm >/dev/null 2>&1; then
        PNPM_CMD="pnpm"
    elif [ -f "$HOME/.nvm/versions/node/*/bin/pnpm" ]; then
        PNPM_CMD=$(ls $HOME/.nvm/versions/node/*/bin/pnpm | head -n 1)
    elif [ -f "$HOME/.local/share/pnpm/pnpm" ]; then
        PNPM_CMD="$HOME/.local/share/pnpm/pnpm"
    elif [ -f "/usr/local/bin/pnpm" ]; then
        PNPM_CMD="/usr/local/bin/pnpm"
    else
        echo "Error: pnpm not found. Installing pnpm..."
        # 尝试安装 pnpm
        if command -v npm >/dev/null 2>&1; then
            npm install -g pnpm
            if [ $? -eq 0 ]; then
                PNPM_CMD="pnpm"
            else
                echo "Error: Failed to install pnpm"
                exit 1
            fi
        else
            echo "Error: Neither pnpm nor npm is installed"
            exit 1
        fi
    fi
}

# 创建必要的目录
mkdir -p "$DATA_DIR" "$CONFIG_DIR" "$LOG_DIR"

# 检查 pnpm
check_pnpm

# 创建用户实例
create_user() {
    local user_id=$1
    if [ -z "$user_id" ]; then
        echo "Error: 需要用户ID"
        return 1
    fi

    # 创建用户数据目录
    mkdir -p "${DATA_DIR}/user_${user_id}"
    
    # 创建用户配置文件
    cat > "${CONFIG_DIR}/user_${user_id}.env" <<EOL
USER_ID=${user_id}
PORT=$((3000 + ${user_id}))
DB_PATH=${DATA_DIR}/user_${user_id}/db.sqlite
OPENAI_API_KEY=
TWITTER_USERNAME=
TWITTER_PASSWORD=
TWITTER_EMAIL=
WALLET_SECRET_SALT=secret_salt_${user_id}
EOL

    echo "创建用户 ${user_id} 的配置文件：${CONFIG_DIR}/user_${user_id}.env"
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

    # 检查是否已运行
    if pgrep -f "node.*USER_ID=${user_id}" > /dev/null; then
        echo "用户 ${user_id} 的实例已在运行"
        return 0
    fi

    # 检查应用目录是否存在
    if [ ! -d "$BASE_DIR" ]; then
        echo "Error: 应用目录 $BASE_DIR 不存在"
        return 1
    fi

    # 检查 package.json 是否存在
    if [ ! -f "$BASE_DIR/package.json" ]; then
        echo "Error: package.json 不存在于 $BASE_DIR"
        return 1
    fi

    # 加载环境变量
    source "${CONFIG_DIR}/user_${user_id}.env"

    # 启动应用
    cd "$BASE_DIR" && \
    echo "正在启动应用..." && \
    echo "使用 PNPM: $PNPM_CMD" && \
    PORT=$PORT \
    USER_ID=$user_id \
    DB_PATH=$DB_PATH \
    nohup $PNPM_CMD start > "${LOG_DIR}/user_${user_id}.log" 2>&1 &

    echo "用户 ${user_id} 的应用已启动在端口 $PORT"
    echo "日志文件: ${LOG_DIR}/user_${user_id}.log"
}

# 停止用户实例
stop_user() {
    local user_id=$1
    if [ -z "$user_id" ]; then
        echo "Error: 需要用户ID"
        return 1
    fi

    pkill -f "node.*USER_ID=${user_id}"
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

case "$1" in
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
    *)
        echo "Usage: $0 {create|remove|start|stop|restart|logs|list} [user_id]"
        exit 1
        ;;
esac
