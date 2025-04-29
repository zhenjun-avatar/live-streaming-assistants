#!/bin/bash

# 配置 - 使用相对路径
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
BASE_DIR="$SCRIPT_DIR"              # 应用根目录
DATA_DIR="${BASE_DIR}/user_data"    # 用户数据目录
CONFIG_DIR="${BASE_DIR}/config"     # 用户配置目录
LOG_DIR="${BASE_DIR}/logs"          # 日志目录
REQUIRED_NODE_VERSION="23.3.0"      # 需要的 Node.js 版本
REQUIRED_PNPM_VERSION="10.6.2"      # 需要的 pnpm 版本
PORT_START=3000                     # 起始端口
PORT_END=3999                       # 结束端口
INACTIVE_TIMEOUT=3600              # 不活跃超时时间（秒）

# 设置目录权限
setup_directories() {
    echo "设置目录权限..."
    mkdir -p "$DATA_DIR" "$CONFIG_DIR" "$LOG_DIR"
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
    mkdir -p "${DATA_DIR}/user_${user_id}"
    chmod 755 "${DATA_DIR}/user_${user_id}"
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

# 获取可用端口
get_available_port() {
    local user_id=$1
    # 使用用户ID计算端口号
    local port=$((3000 + ($user_id % 1000)))
    echo $port
    return 0
}

# 创建用户实例
create_user() {
    local user_id=$1
    if [ -z "$user_id" ]; then
        echo "Error: 需要用户ID"
        return 1
    fi

    # 获取可用端口
    local port=$(get_available_port "$user_id")
    
    # 设置目录权限
    setup_user_directories "$user_id"
    
    # 创建用户配置文件
    mkdir -p "$CONFIG_DIR"
    cat > "${CONFIG_DIR}/user_${user_id}.env" <<EOL
USER_ID=${user_id}
SERVER_PORT=${port}
SQLITE_FILE=${DATA_DIR}/user_${user_id}/db.sqlite
BASE_PATH=/user/${user_id}
EOL

    echo "创建用户 ${user_id} 的配置文件：${CONFIG_DIR}/user_${user_id}.env"
    echo "分配端口: $port"
    echo "访问路径: /user/${user_id}/"
    echo "内部端口: $port"
    
    # 启动用户实例
    start_user "$user_id"
}

# 修改进程检查函数
check_process() {
    local user_id=$1
    local detailed=$2

    echo "正在检查用户 ${user_id} 的进程状态..."
    echo "访问路径: /user/${user_id}/"
    echo "内部端口: $SERVER_PORT"
    
    # 检查端口是否在监听
    local port_status=$(netstat -ano | grep ":$SERVER_PORT.*LISTENING" || true)
    echo "端口状态: $port_status"
    
    if [ -n "$port_status" ]; then
        # 获取 Windows 进程 ID
        local win_pid=$(echo "$port_status" | head -n1 | awk '{print $NF}')
        echo "Windows 进程ID: $win_pid"
        echo "running"
        return 1
    else
        echo "stopped"
        return 0
    fi
}

# 修改 status_user 函数
status_user() {
    local user_id=$1
    if [ -z "$user_id" ]; then
        echo "Error: 需要用户ID"
        return 1
    fi

    # 检查配置文件是否存在
    if [ ! -f "${CONFIG_DIR}/user_${user_id}.env" ]; then
        echo "状态: 未配置"
        echo "Error: 用户配置文件不存在"
        return 1
    fi

    # 加载配置
    source "${CONFIG_DIR}/user_${user_id}.env"
    
    echo "正在检查用户 ${user_id} 的状态..."
    echo "配置的端口: $SERVER_PORT"

    # 获取进程状态
    check_process "$user_id" "true"
    local process_running=$?

    echo "用户ID: $user_id"
    echo "配置文件: ${CONFIG_DIR}/user_${user_id}.env"
    echo "数据目录: ${DATA_DIR}/user_${user_id}"
    echo "日志文件: ${LOG_DIR}/user_${user_id}.log"
    echo "端口: $SERVER_PORT"
    echo "访问路径: /user/${user_id}/"

    if [ $process_running -eq 1 ]; then
        echo "状态: 运行中"
        
        # 获取 Windows 进程 ID
        local win_pid=$(netstat -ano | grep ":$SERVER_PORT.*LISTENING" | head -n1 | awk '{print $NF}')
        echo "进程ID: $win_pid"

        # 检查日志文件
        if [ -f "${LOG_DIR}/user_${user_id}.log" ]; then
            echo -e "\n最近的日志:"
            tail -n 5 "${LOG_DIR}/user_${user_id}.log"
        fi
    else
        echo "状态: 已停止"
        
        # 检查是否有PID文件
        if [ -f "${DATA_DIR}/user_${user_id}/pid" ]; then
            echo "警告: PID文件存在但进程未运行"
            echo "上次记录的PID: $(cat "${DATA_DIR}/user_${user_id}/pid")"
        fi

        # 显示最后的错误日志
        if [ -f "${LOG_DIR}/user_${user_id}.log" ]; then
            echo -e "\n最后的错误日志:"
            tail -n 10 "${LOG_DIR}/user_${user_id}.log"
        fi
    fi
}

# 修改 start_user 函数
start_user() {
    echo "开始启动用户 ${user_id} 的实例..."
    local user_id=$1
    if [ -z "$user_id" ]; then
        echo "Error: 需要用户ID"
        return 1
    fi

    # 检查依赖
    check_node || return 1
    check_pnpm || return 1

    # 检查是否已运行
    if check_process "$user_id"; then
        echo "用户 ${user_id} 的实例已在运行"
        
        # 输出实例信息
        if [ -f "${CONFIG_DIR}/user_${user_id}.env" ]; then
            source "${CONFIG_DIR}/user_${user_id}.env"
            echo "访问路径: /user/${user_id}/"
            echo "内部端口: $SERVER_PORT"
            echo "数据库文件: $SQLITE_FILE"
            echo "日志文件: ${LOG_DIR}/user_${user_id}.log"
            if [ -f "${DATA_DIR}/user_${user_id}/pid" ]; then
                echo "进程ID: $(cat "${DATA_DIR}/user_${user_id}/pid")"
            fi
        fi
        return 1
    fi

    # 确保日志文件存在
    mkdir -p "$LOG_DIR"
    touch "${LOG_DIR}/user_${user_id}.log"

    # 加载环境变量
    if [ ! -f "${CONFIG_DIR}/user_${user_id}.env" ]; then
        echo "Error: 用户配置文件不存在"
        return 1
    fi
    source "${CONFIG_DIR}/user_${user_id}.env"

    # 启动应用
    echo "正在启动用户 ${user_id} 的应用..."
    
    # 使用 node 直接启动而不是 pnpm start
    (cd "$BASE_DIR" && \
    SERVER_PORT=$SERVER_PORT \
    USER_ID=$USER_ID \
    SQLITE_FILE=$SQLITE_FILE \
    BASE_PATH=/user/${user_id} \
    pnpm start --character="characters/snoop.json" > "${LOG_DIR}/user_${user_id}.log" 2>&1) &

    # 保存进程ID
    local pid=$!
    echo $pid > "${DATA_DIR}/user_${user_id}/pid"

    # 等待进程启动
    local max_attempts=10
    local attempt=1
    local is_running=false

    while [ $attempt -le $max_attempts ]; do
        sleep 2
        if check_process "$user_id"; then
            is_running=true
            break
        fi
        echo "等待应用启动... (尝试 $attempt/$max_attempts)"
        attempt=$((attempt + 1))
    done

    if $is_running; then
        echo "用户 ${user_id} 的应用已成功启动"
        echo "访问路径: /user/${user_id}/"
        echo "内部端口: $SERVER_PORT"
        echo "数据库文件: $SQLITE_FILE"
        echo "日志文件: ${LOG_DIR}/user_${user_id}.log"
        echo "进程ID: $pid"
        
        # 显示启动日志
        echo -e "\n最近的启动日志："
        tail -n 5 "${LOG_DIR}/user_${user_id}.log"
        return 0
    else
        echo "Error: 应用启动失败，请检查日志文件"
        echo -e "\n最后 10 行日志："
        tail -n 10 "${LOG_DIR}/user_${user_id}.log"
        return 1
    fi
}

# 修改 stop_user 函数
stop_user() {
    local user_id=$1
    if [ -z "$user_id" ]; then
        echo "Error: 需要用户ID"
        return 1
    fi

    # 加载配置以获取端口号
    if [ -f "${CONFIG_DIR}/user_${user_id}.env" ]; then
        source "${CONFIG_DIR}/user_${user_id}.env"
        
        # 通过端口号找到 Windows 进程 ID
        local win_pid=$(netstat -ano | grep ":$SERVER_PORT.*LISTENING" | awk '{print $NF}' | head -n1)
        if [ -n "$win_pid" ]; then
            echo "正在停止端口 $SERVER_PORT 的进程 (Windows PID: $win_pid)..."
            
            # 使用 taskkill 终止进程树
            taskkill //F //T //PID $win_pid
            
            sleep 2
            
            # 检查端口是否还在监听
            if netstat -ano | grep ":$SERVER_PORT.*LISTENING" > /dev/null; then
                echo "端口仍在监听，尝试强制终止相关进程..."
                # 查找并终止所有相关的 node 进程
                ps aux | grep "node" | grep -v grep | awk '{print $1}' | xargs -r kill -9
            fi
        fi
    fi

    # 清理 PID 文件
    if [ -f "${DATA_DIR}/user_${user_id}/pid" ]; then
        rm "${DATA_DIR}/user_${user_id}/pid"
    fi

    echo "用户 ${user_id} 的实例已停止"
}

# 添加重启功能
restart_user() {
    local user_id=$1
    if [ -z "$user_id" ]; then
        echo "Error: 需要用户ID"
        return 1
    fi

    echo "正在重启用户 ${user_id} 的实例..."
    stop_user "$user_id"
    sleep 2
    start_user "$user_id"
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

    cat "${LOG_DIR}/user_${user_id}.log"
}

# 修改 list_users 函数
list_users() {
    echo "用户数据目录："
    ls -l "$DATA_DIR" | grep "user_" || echo "没有用户数据目录"
    
    echo -e "\n用户配置文件："
    ls -l "$CONFIG_DIR" | grep "user_.*\.env" || echo "没有用户配置文件"
    
    echo -e "\n已分配的端口和状态："
    for env_file in "${CONFIG_DIR}"/user_*.env; do
        if [ -f "$env_file" ]; then
            user_id=$(basename "$env_file" .env | sed 's/user_//')
            source "$env_file"
            port=$SERVER_PORT
            
            # 检查端口是否在监听
            if netstat -ano | grep ":$port.*LISTENING" > /dev/null; then
                status="运行中"
                pid=$(netstat -ano | grep ":$port.*LISTENING" | awk '{print $NF}' | head -n1)
                echo "用户 $user_id: 端口 $port ($status, PID: $pid)"
            else
                status="已停止"
                echo "用户 $user_id: 端口 $port ($status)"
            fi
        fi
    done
}

# 修改 cleanup 函数
cleanup() {
    echo "正在清理所有用户实例..."
    
    # 遍历所有配置文件找到正在运行的实例
    for env_file in "${CONFIG_DIR}"/user_*.env; do
        if [ -f "$env_file" ]; then
            source "$env_file"
            local win_pid=$(netstat -ano | grep ":$SERVER_PORT.*LISTENING" | awk '{print $NF}' | head -n1)
            if [ -n "$win_pid" ]; then
                echo "正在终止端口 $SERVER_PORT 的进程 (Windows PID: $win_pid)..."
                taskkill //F //T //PID $win_pid
            fi
        fi
    done

    # 额外清理可能残留的 node 进程
    ps aux | grep "node" | grep -v grep | awk '{print $1}' | xargs -r kill -9

    # 清理所有 PID 文件
    rm -f "${DATA_DIR}"/*/pid
    echo "清理完成"
}

# 主命令处理
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
    "status")
        status_user "$2"
        ;;
    "cleanup")
        cleanup
        ;;
    *)
        echo "Usage: $0 {create|remove|start|stop|restart|logs|list|status|cleanup} [user_id]"
        echo
        echo "Commands:"
        echo "  create <user_id>  - 创建新用户实例"
        echo "  remove <user_id>  - 移除用户实例"
        echo "  start <user_id>   - 启动用户实例"
        echo "  stop <user_id>    - 停止用户实例"
        echo "  restart <user_id> - 重启用户实例"
        echo "  logs <user_id>    - 查看用户日志"
        echo "  status <user_id>  - 查看实例状态"
        echo "  list             - 列出所有用户实例"
        echo "  cleanup          - 清理所有用户实例"
        exit 1
        ;;
esac 